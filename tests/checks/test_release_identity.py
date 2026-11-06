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
                from linux_idmap.core import IdMap, IdRange
                from linux_idmap.probe import ProbeResult
                observed = SimpleNamespace(
                    uid_map=IdMap([IdRange(*row) for row in uids]),
                    gid_map=IdMap([IdRange(*row) for row in gids]))
                self.assertEqual(expected, release_identity.map_owner(observed, 1000, 100))

    def test_unmapped_host_owner_is_rejected(self):
        from linux_idmap.core import IdMap, IdRange
        observed = SimpleNamespace(uid_map=IdMap([IdRange(0, 100000, 65536)]),
                                   gid_map=IdMap([IdRange(0, 200000, 65536)]))
        with self.assertRaises(ValueError):
            release_identity.map_owner(observed, 1000, 100)

    def test_cached_wheel_must_match_the_release_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / release_identity.WHEEL_NAME
            wheel.write_bytes(b"wrong wheel")
            with self.assertRaisesRegex(ValueError, "checksum"):
                release_identity.ensure_wheel(root, download=lambda _: self.fail("must not download"))

    def test_probe_only_maps_after_success(self):
        from linux_idmap.core import IdMap, IdRange
        observed = SimpleNamespace(
            uid_map=IdMap([IdRange(0, 1000, 1), IdRange(1, 100000, 65536)]),
            gid_map=IdMap([IdRange(0, 100, 1), IdRange(1, 200000, 65536)]))
        seen = []
        def probe(request):
            seen.append((request.endpoint, request.image, request.user_uid, request.user_gid, request.userns_mode))
            return observed
        self.assertEqual((0, 0), release_identity.probe_owner(
            "unix:///run/user/1000/docker.sock", "python:local", 1000, 100, probe=probe))
        self.assertEqual([("unix:///run/user/1000/docker.sock", "python:local", 0, 0, "default")], seen)
