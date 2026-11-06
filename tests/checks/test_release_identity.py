"""Source-release identity must match host ownership across Docker namespace modes."""

import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from tools import release_identity


class IdentityTests(unittest.TestCase):
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
