"""Update one existing viewer from deploy/viewer without deployment state files.

Docker owns release identity and retained images. This controller is loaded
before changing its source checkout; child Make processes use the new source.
Runtime Compose changes require an operator migration so image rollback can
reuse the same configuration without saving configuration snapshots.
"""

from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from urllib.parse import urljoin, urlsplit
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://github.com/numpde/dapp32"
REVISION = re.compile(r"[0-9a-f]{40}")
IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}")


def execute(args: list[str], *, timeout: float, capture: bool) -> str:
    """Wait for the command group to stop before another operation may start.

    Make's children can outlive Make on cancellation. Give the entire group
    time for EXIT teardown, then kill survivors before permitting rollback.
    A new session also keeps outer timer cancellation under this owner's care.
    """
    process = subprocess.Popen(args, cwd=ROOT, start_new_session=True, text=True,
                               stdout=subprocess.PIPE if capture else None)
    try:
        output, _ = process.communicate(timeout=timeout)
    except (subprocess.TimeoutExpired, TimeoutError, KeyboardInterrupt):
        try:
            os.killpg(process.pid, signal.SIGTERM)
        # silent-defaults: allow-exception-fallback -- The group may exit between cancellation and signaling; it already satisfies termination.
        except ProcessLookupError:
            pass
        end = time.monotonic() + 60
        while time.monotonic() < end:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        try:
            os.killpg(process.pid, signal.SIGKILL)
        # silent-defaults: allow-exception-fallback -- A fully exited group needs no forced termination.
        except ProcessLookupError:
            pass
        process.communicate()
        raise
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, args)
    if capture:
        return output.strip()
    return ""


# silent-defaults: allow-default -- Engine and Git probes have a fixed two-minute operational deadline, not a substituted operator input.
def run(*args: str, timeout: int = 120) -> str:
    """Run one bounded operator command, preserving its stderr on failure."""
    return execute(list(args), timeout=timeout, capture=True)


def docker(*args: str) -> str:
    return run("docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], *args)


def inspect(kind: str, identifier: str) -> dict:
    """Read one exact engine object; malformed responses cannot authorize effects."""
    objects = json.loads(docker(kind, "inspect", identifier))
    if not isinstance(objects, list) or len(objects) != 1 or not isinstance(objects[0], dict):
        raise ValueError(f"Cannot inspect exactly one {kind}: {identifier}")
    return objects[0]


def image_revision(image: dict, project: str) -> str:
    """Admit clean viewer images built for this project, never nginx's labels."""
    labels = image["Config"]["Labels"]
    if not isinstance(labels, dict):
        raise ValueError("Viewer image does not contain identity labels")
    revision = labels.get("org.opencontainers.image.revision")
    if (labels.get("org.opencontainers.image.source") != SOURCE
            or labels.get("com.cam.role") != "viewer"
            or labels.get("com.cam.viewer.project") != project
            or labels.get("com.cam.viewer.modified") != "false"
            or not isinstance(revision, str) or not REVISION.fullmatch(revision)):
        raise ValueError("Viewer image lacks clean viewer-owned identity; establish a labeled release with the manual build/up workflow first")
    return revision


def live_viewer(project: str) -> dict:
    """Require the single existing runtime, including stopped or unhealthy state."""
    containers = docker("container", "ls", "--all", "--quiet", "--no-trunc",
                        "--filter", f"label=com.docker.compose.project={project}",
                        "--filter", "label=com.docker.compose.service=viewer",
                        "--filter", "label=com.docker.compose.oneoff=False").splitlines()
    if len(containers) != 1:
        raise ValueError(f"Expected one existing viewer in {project}; found {len(containers)}. Use manual build/up for initial installation")
    container = inspect("container", containers[0])
    identifier = container.get("Image")
    if not isinstance(identifier, str) or not IMAGE_ID.fullmatch(identifier):
        raise ValueError("Cannot determine the existing viewer's immutable image ID")
    return container


def healthy(container: dict) -> bool:
    state = container["State"]
    health = state.get("Health")
    return state["Running"] is True and isinstance(health, dict) and health.get("Status") == "healthy"


class EntryScript(HTMLParser):
    """Find the Vite entry module; remote or ambiguous entries are not admitted."""

    def __init__(self):
        super().__init__()
        self.entries = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and attributes.get("type") == "module":
            self.entries.append(attributes.get("src"))


def public_revision(origin: str, revision: str) -> None:
    """Observe the public entry bundle's revision without writing an artifact.

    This checks the served revision, not publication integrity of every asset.
    Reads are bounded even if the server ignores its Content-Length header.
    """
    def read(path: str, limit: int) -> str:
        with urlopen(urljoin(origin + "/", path), timeout=15) as response:
            final = urlsplit(response.geturl())
            if (final.scheme, final.netloc) != ("https", urlsplit(origin).netloc):
                raise ValueError("Viewer response redirected away from the configured public origin")
            content = response.read(limit + 1)
        if len(content) > limit:
            raise ValueError(f"Public viewer response exceeds {limit} bytes")
        return content.decode("utf-8")

    document = EntryScript()
    document.feed(read("/", 512 * 1024))
    if (len(document.entries) != 1 or not isinstance(document.entries[0], str)
            or not re.fullmatch(r"(?:\./|/)?assets/[A-Za-z0-9_.-]+\.js", document.entries[0])):
        raise ValueError("Public viewer index must declare one local assets/*.js module")
    if revision not in read(document.entries[0], 8 * 1024 * 1024):
        raise ValueError(f"Public viewer entry bundle does not identify revision {revision}")


def make(target: str, *, image: str | None = None) -> None:
    """Reuse Make's recursive endpoint handoff and the existing runtime settings."""
    args = ["make", "--no-print-directory", target, "DOCKER_CONTEXT=",
            "CAM_DOCKER_ENDPOINT=" + os.environ["CAM_DOCKER_ENDPOINT"],
            "COMPOSE_PROJECT_NAME=cam-viewer-update",
            "VIEWER_COMPOSE_PROJECT_NAME=" + os.environ["VIEWER_COMPOSE_PROJECT_NAME"],
            "VIEWER_BIND_HOST=" + os.environ["VIEWER_BIND_HOST"], "VIEWER_PORT=" + os.environ["VIEWER_PORT"]]
    if image:
        args.append("VIEWER_IMAGE=" + image)
    if target == "base-images/pull":
        args.append("DOCKERFILES=containers/node-deps/Dockerfile containers/https-egress-proxy/Dockerfile containers/viewer/Dockerfile")
    # Build/install progress belongs in the journal; keep it visible immediately.
    execute(args, timeout=75 if target == "viewer/up" else 600, capture=False)


def retire_images(project: str, repository: str) -> None:
    """Retire only this updater's obsolete image tags; Docker refuses in-use removal.

    Separate builds may deliberately keep other tags. Preserve such images,
    all container references, and both release tags. Never force image removal.
    """
    protected = set()
    for tag in ("current", "rollback"):
        protected.update(docker("image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={repository}:{tag}").splitlines())
    containers = docker("container", "ls", "--all", "--quiet", "--no-trunc").splitlines()
    if containers:
        for container in json.loads(docker("container", "inspect", *containers)):
            image = container["Image"]
            if not IMAGE_ID.fullmatch(image):
                raise ValueError("Cannot establish container image references for cleanup")
            protected.add(image)
    filters = ("--filter", "label=com.cam.role=viewer", "--filter", f"label=com.cam.viewer.project={project}",
               "--filter", f"label=org.opencontainers.image.source={SOURCE}")
    for identifier in set(docker("image", "ls", "--quiet", "--no-trunc", *filters).splitlines()):
        if identifier in protected:
            continue
        image = inspect("image", identifier)
        tags = image["RepoTags"]
        if tags and all(tag.startswith(repository + ":") for tag in tags):
            for tag in tags:
                docker("image", "rm", tag)
    docker("image", "prune", "--force", *filters)


def update() -> None:
    """Perform one attempt; preserve Docker recovery inputs until success is known."""
    project = os.environ["VIEWER_COMPOSE_PROJECT_NAME"]
    if "VIEWER_PUBLIC_ORIGIN" not in os.environ:
        raise ValueError("Set VIEWER_PUBLIC_ORIGIN to the viewer's HTTPS origin")
    origin = os.environ["VIEWER_PUBLIC_ORIGIN"]
    url = urlsplit(origin)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.path or url.query or url.fragment:
        raise ValueError("Set VIEWER_PUBLIC_ORIGIN to an HTTPS origin without credentials, path, query or fragment")
    if run("git", "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Viewer update refuses local source changes; preserve them before retrying")
    run("git", "fetch", "--no-tags", "origin", "refs/heads/deploy/viewer")
    target = run("git", "rev-parse", "--verify", "FETCH_HEAD^{commit}")
    if not REVISION.fullmatch(target):
        raise ValueError("Fetched deployment branch did not resolve to one exact source revision")
    container = live_viewer(project)
    bindings = container["HostConfig"]["PortBindings"].get("8080/tcp")
    if bindings != [{"HostIp": os.environ["VIEWER_BIND_HOST"], "HostPort": os.environ["VIEWER_PORT"]}]:
        raise ValueError("Viewer bind/port settings differ from the existing runtime; migrate them manually before automatic updates")
    old_id = container["Image"]
    old_revision = image_revision(inspect("image", old_id), project)
    repository = "cam-viewer-" + project
    if healthy(container) and old_revision == target:
        public_revision(origin, target)
        run("git", "checkout", "--detach", target)
        docker("image", "tag", old_id, repository + ":current")
        retire_images(project, repository)
        print(f"Viewer already healthy at {target}; no build needed.", flush=True)
        return
    # Runtime settings stay in operator configuration. Refuse model changes
    # instead of secretly creating snapshots or risking incompatible rollback.
    if run("git", "show", old_revision + ":compose/viewer.yml") != run("git", "show", target + ":compose/viewer.yml"):
        raise ValueError("Deployment changes compose/viewer.yml; migrate runtime configuration manually before enabling automatic updates")
    restore_id = old_id
    restore_revision = old_revision
    if not healthy(container):
        rollback = docker("image", "ls", "--quiet", "--no-trunc", "--filter", f"reference={repository}:rollback").splitlines()
        if len(rollback) != 1 or not IMAGE_ID.fullmatch(rollback[0]):
            raise ValueError("Viewer is unhealthy and has no retained rollback image; recover it manually before updating")
        restore_id = rollback[0]
        restore_revision = image_revision(inspect("image", restore_id), project)
        if run("git", "show", restore_revision + ":compose/viewer.yml") != run("git", "show", target + ":compose/viewer.yml"):
            raise ValueError("Retained rollback requires a different runtime model; recover manually before updating")
    run("git", "checkout", "--detach", target)
    make("base-images/pull")
    make("js/deps/install")
    if run("git", "status", "--porcelain", "--untracked-files=all"):
        raise ValueError("Dependency preparation changed source; running viewer was left unchanged")
    candidate = repository + ":" + target
    try:
        make("viewer/image/build", image=candidate)
        image = inspect("image", candidate)
        candidate_id = image["Id"]
        if not IMAGE_ID.fullmatch(candidate_id) or image_revision(image, project) != target:
            raise ValueError("Built image identity does not match the fetched release")
        if healthy(container):
            # Protect the actual old runtime before replacement, even when the
            # operator initially used only a revision tag. A later tag failure
            # must not let cleanup delete the known-good recovery image.
            docker("image", "tag", old_id, repository + ":current")
        try:
            make("viewer/up", image=candidate_id)
            current = live_viewer(project)
            if current["Image"] != candidate_id or not healthy(current):
                raise ValueError("Replacement viewer did not reach healthy state with the selected image")
            public_revision(origin, target)
        except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as activation:
            print(f"Activation failed: {activation}. Attempting rollback to {restore_id}.", file=sys.stderr, flush=True)
            try:
                make("viewer/up", image=restore_id)
                restored = live_viewer(project)
                if restored["Image"] != restore_id or not healthy(restored):
                    raise ValueError("Rollback runtime is not healthy with the retained image")
                public_revision(origin, restore_revision)
            except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as recovery:
                print(f"Rollback failed: {recovery}", file=sys.stderr, flush=True)
                raise RuntimeError(f"Rollback could not be confirmed; images retained. Inspect viewer/status and recover with VIEWER_IMAGE={restore_id}") from recovery
            print("Rollback is healthy; the attempted update still failed.", file=sys.stderr, flush=True)
            raise
        # Keep the prior rollback until activation succeeds. An unhealthy old
        # container must never replace the known-good rollback image.
        if healthy(container):
            docker("image", "tag", old_id, repository + ":rollback")
        docker("image", "tag", candidate_id, repository + ":current")
        print(f"Viewer is healthy and publicly serves {target}.", flush=True)
    except RuntimeError:
        # Uncertain rollback: do not retire any possible recovery input.
        raise
    except (OSError, ValueError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt):
        try:
            retire_images(project, repository)
        except (OSError, ValueError, subprocess.SubprocessError) as cleanup:
            print(f"Image cleanup also failed; obsolete images may remain: {cleanup}", file=sys.stderr)
        raise
    retire_images(project, repository)


def interrupted(signum, frame):
    raise TimeoutError("Viewer update interrupted; an activation in progress will attempt rollback")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    try:
        update()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, TimeoutError, KeyboardInterrupt) as error:
        print(f"Viewer update failed: {error}", file=sys.stderr)
        sys.exit(1)
