"""Source-release identity must match host ownership across Docker namespace modes."""

import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools import release_identity


class IdentityTests(unittest.TestCase):
    def test_release_pin_matches_published_linux_idmap_v031(self):
        # GitHub's published release asset digest (2026-11-06); update this
        # reviewed contract alongside the pinned wheel, never from a guess.
        self.assertEqual("linux_idmap-0.3.1-py3-none-any.whl", release_identity.WHEEL_NAME)
        self.assertEqual(
            "2833b26881903f8cb1b12ed16f442db8e1f487283a550eccd3fc10ee7bacd9c8",
            release_identity.WHEEL_SHA256,
        )
        self.assertEqual(
            "https://github.com/numpde/container-tools/releases/download/v0.3.1/"
            + release_identity.WHEEL_NAME,
            release_identity.WHEEL_URL,
        )

    def test_map_matches_host_user_in_rootless_and_rootful_namespaces(self):
        cases = [
            (((0, 1000, 1), (1, 100000, 65536)), ((0, 100, 1), (1, 200000, 65536)), (0, 0)),
            (((0, 0, 65536),), ((0, 0, 65536),), (1000, 100)),
        ]
        for uids, gids, expected in cases:
            with self.subTest(expected=expected):
                def inverse(rows):
                    return SimpleNamespace(translate_inverse=lambda target: next(
                        inside + target - outside for inside, outside, count in rows
                        if outside <= target < outside + count))
                observed = SimpleNamespace(uid_map=inverse(uids), gid_map=inverse(gids))
                self.assertEqual(expected, release_identity.map_owner(observed, 1000, 100))

    def test_unmapped_host_owner_is_rejected(self):
        def unmapped(target):
            raise ValueError("host owner not mapped")
        observed = SimpleNamespace(uid_map=SimpleNamespace(translate_inverse=unmapped),
                                   gid_map=SimpleNamespace(translate_inverse=unmapped))
        with self.assertRaises(ValueError):
            release_identity.map_owner(observed, 1000, 100)

    def test_cached_wheel_must_match_the_release_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / release_identity.WHEEL_NAME
            wheel.write_bytes(b"wrong wheel")
            with self.assertRaisesRegex(ValueError, "checksum"):
                release_identity.ensure_wheel(root, download=lambda _: self.fail("must not download"))

    def test_checked_download_is_cached_without_repeating_network(self):
        import hashlib
        with tempfile.TemporaryDirectory() as directory:
            payload = b"deterministic wheel bytes"
            with patch.object(release_identity, "WHEEL_SHA256", hashlib.sha256(payload).hexdigest()):
                path = release_identity.ensure_wheel(Path(directory), download=lambda url: payload)
                self.assertEqual(payload, path.read_bytes())
                again = release_identity.ensure_wheel(Path(directory),
                    download=lambda url: self.fail("cache unexpectedly downloaded again"))
                self.assertEqual(path, again)

    def test_shell_selection_reuses_one_probe_and_discards_stale_ids_on_failure(self):
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            calls = Path(directory) / "probes"
            script = r'''
source tools/release_identity.sh
docker() { [[ "$*" == *'image inspect'* ]]; }
python3() {
  if [[ "${1-}" == -I && "${2-}" == -S && "${3-}" == -B ]]; then
    printf '%s\n' "$CAM_DOCKER_ENDPOINT" >> "$CALLS"
    case "$CAM_DOCKER_ENDPOINT" in
      *one.sock) printf '0:0\n' ;;
      *two.sock) return 3 ;;
      *) return 2 ;;
    esac
  else
    command python3 "$@"
  fi
}
# Raw inherited numbers are not authority without the selected-shell receipt.
RELEASE_CONTAINER_UID=0 RELEASE_CONTAINER_GID=0
status=0
release_with_mapped_owner true || status=$?
[[ "$status" == 2 ]]
release_select_container_identity
[[ "$RELEASE_CONTAINER_UID:$RELEASE_CONTAINER_GID" == 0:0 ]]
release_with_mapped_owner bash -c '[[ "$LOCAL_UID:$LOCAL_GID" == "0:0" ]]'
[[ "$LOCAL_UID:$LOCAL_GID" == "$(id -u):$(id -g)" ]]
CAM_DOCKER_ENDPOINT=unix:///tmp/stale.sock
status=0
release_with_mapped_owner true || status=$?
[[ "$status" == 2 ]]
CAM_DOCKER_ENDPOINT=unix:///tmp/one.sock
release_select_container_identity
[[ "$(wc -l < "$CALLS")" -eq 1 ]]
CAM_DOCKER_ENDPOINT=unix:///tmp/two.sock
status=0
release_select_container_identity || status=$?
[[ "$status" == 3 ]]
[[ ! -v RELEASE_CONTAINER_UID && ! -v RELEASE_CONTAINER_GID ]]
status=0
release_with_mapped_owner true || status=$?
[[ "$status" == 2 ]]
[[ "$(wc -l < "$CALLS")" -eq 2 ]]
'''
            env = {**os.environ, "LOCAL_UID": str(os.getuid()), "LOCAL_GID": str(os.getgid()),
                   "CAM_DOCKER_ENDPOINT": "unix:///tmp/one.sock", "CALLS": str(calls)}
            completed = subprocess.run(["bash", "-euo", "pipefail", "-c", script],
                                        env=env, cwd=Path(__file__).resolve().parents[2],
                                        capture_output=True, text=True, timeout=12)
            self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)


    def test_release_configuration_private_mounts_use_the_mapped_identity(self):
        from .common import rendered_compose_config
        config = rendered_compose_config("compose/release/config.yml")
        private_roots = ("/tmp/release-config-stage", "/tmp/release-config.json")
        consumers = {}
        for name, service in config["services"].items():
            sources = [
                mount["source"] for mount in service.get("volumes", ())
                if mount["type"] == "bind"
                and any(mount["source"] == root or mount["source"].startswith(root + "/")
                        for root in private_roots)
            ]
            if sources:
                consumers[name] = service.get("user")
        self.assertEqual({"release-setup", "release-config", "release-instance"}, set(consumers))
        for service, user in consumers.items():
            with self.subTest(service=service):
                self.assertEqual("1000:1000", user, "Private instance/configuration mounts need the mapped container user")

    def test_probe_only_maps_after_success(self):
        observed = SimpleNamespace(
            uid_map=SimpleNamespace(translate_inverse=lambda value: 0 if value == 1000 else -1),
            gid_map=SimpleNamespace(translate_inverse=lambda value: 0 if value == 100 else -1))
        seen = []
        def probe(request):
            seen.append((request.endpoint, request.image, request.user_uid, request.user_gid, request.userns_mode))
            return observed
        self.assertEqual((0, 0), release_identity.probe_owner(
            "unix:///run/user/1000/docker.sock", "python:local", 1000, 100, probe=probe,
            request_factory=lambda **kwargs: SimpleNamespace(**kwargs, userns_mode="default")))
        self.assertEqual([("unix:///run/user/1000/docker.sock", "python:local", 0, 0, "default")], seen)
