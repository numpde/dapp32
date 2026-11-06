"""Resolve a private host owner's container IDs using the pinned linux-idmap release."""

import argparse
import hashlib
import os
from pathlib import Path
import stat
import sys
import tempfile
import urllib.request


WHEEL_NAME = "linux_idmap-0.3.0-py3-none-any.whl"
WHEEL_SHA256 = "2fd5ff0b0bae1ce97d23fb2e8f24adcac156cafa4afdb3a2fbf089e91790d428"
WHEEL_URL = "https://github.com/numpde/container-tools/releases/download/v0.3.0/" + WHEEL_NAME


def download_wheel(url):
    request = urllib.request.Request(url, headers={"User-Agent": "release-idmap-bootstrap/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        contents = response.read(512 * 1024 + 1)
    if len(contents) > 512 * 1024:
        raise ValueError("Pinned linux-idmap wheel exceeds 512 KiB")
    return contents


# silent-defaults: allow-default -- Normal operation downloads from the pinned release; tests inject an offline downloader.
def ensure_wheel(cache, *, download=download_wheel):
    """Acquire one immutable release wheel; never execute an unverified cached copy."""
    cache = Path(cache)
    cache.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = cache.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("linux-idmap cache must be a private caller-owned directory")
    wheel = cache / WHEEL_NAME
    if not wheel.exists() and not wheel.is_symlink():
        print("Acquiring checksum-pinned linux-idmap 0.3.0 wheel for host identity mapping.", file=sys.stderr)
        content = download(WHEEL_URL)
        if hashlib.sha256(content).hexdigest() != WHEEL_SHA256:
            raise ValueError("Downloaded linux-idmap wheel checksum differs from the pinned release")
        descriptor, temporary = tempfile.mkstemp(prefix=".idmap-", dir=cache)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(temporary, wheel)
            # silent-defaults: allow-exception-fallback -- A concurrent writer's file is revalidated by SHA-256 and ownership below.
            except FileExistsError:
                pass  # A concurrent acquisition must be verified below.
        finally:
            os.unlink(temporary)
    info = wheel.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > 512 * 1024:
        raise ValueError("Pinned linux-idmap wheel must be a bounded caller-owned regular file")
    if hashlib.sha256(wheel.read_bytes()).hexdigest() != WHEEL_SHA256:
        raise ValueError("Cached linux-idmap wheel checksum differs from the pinned release")
    return wheel


def map_owner(observation, uid, gid):
    """Inverse-project a host owner; absent mappings fail rather than granting access."""
    return (int(observation.uid_map.translate_inverse(uid)),
            int(observation.gid_map.translate_inverse(gid)))


def probe_owner(endpoint, image, uid, gid, *, probe=None, request_factory=None):
    if probe is None or request_factory is None:
        from linux_idmap.probe import ProbeRequest, probe_identity
        probe = probe or probe_identity
        request_factory = request_factory or ProbeRequest
    observed = probe(request_factory(endpoint=endpoint, image=image,
                                    interpreter="/usr/local/bin/python3",
                                    user_uid=0, user_gid=0))
    return map_owner(observed, uid, gid)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--image", required=True)
    options = parser.parse_args(argv)
    uid, gid = os.getuid(), os.getgid()
    if uid == 0 or gid == 0:
        raise ValueError("Release identity selection requires a non-root host operator")
    if sys.version_info < (3, 11):
        raise ValueError("Release identity selection requires host Python 3.11 or later")
    wheel = ensure_wheel(Path.home() / ".cache" / "release-idmap")
    sys.path.insert(0, str(wheel))  # -I -S: only this checksum-checked wheel is admitted.
    selected_uid, selected_gid = probe_owner(options.endpoint, options.image, uid, gid)
    print(f"{selected_uid}:{selected_gid}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # A failed or unresolved probe must never yield a plausible UID on stdout.
        print(f"Cannot map release operator through selected Docker engine: {error}", file=sys.stderr)
        failure = getattr(error, "as_dict", None)
        if callable(failure):
            import json
            print(json.dumps(failure(), sort_keys=True), file=sys.stderr)
        # In particular, an unresolved probe removal must not be treated as
        # an ordinary settled refusal; the caller retains its operation evidence.
        state = getattr(getattr(error, "retirement", None), "state", None)
        raise SystemExit(3 if state == "uncertain-outcome" else 2)
