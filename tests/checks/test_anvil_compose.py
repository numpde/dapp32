from __future__ import annotations

import re
import sys
import unittest
from typing import Any

from .common import read_text, rendered_compose_config, repo_path


def setUpModule() -> None:
    print("Checking Anvil Compose posture...", file=sys.stderr, flush=True)


class AnvilComposePostureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.no_profile = cls.render_config("")
        cls.internal = cls.render_config("internal")
        cls.host = cls.render_config("host", host_port="18545")
        cls.all_profiles = cls.render_config("internal,host", host_port="18545")

    @staticmethod
    def render_config(profiles: str, *, host_port: str = "8545") -> dict[str, Any]:
        return rendered_compose_config(
            "compose/anvil.yml",
            env={
                "COMPOSE_PROJECT_NAME": "dapps-anvil-check",
                "COMPOSE_PROFILES": profiles,
                "ANVIL_HOST_PORT": host_port,
            },
        )

    def test_profile_service_sets(self) -> None:
        self.assertEqual(sorted(self.no_profile["services"].keys()), [])
        self.assertEqual(sorted(self.internal["services"].keys()), ["anvil-internal"])
        self.assertEqual(sorted(self.host["services"].keys()), ["anvil-host"])
        self.assertEqual(
            sorted(self.all_profiles["services"].keys()),
            ["anvil-host", "anvil-internal"],
        )

    def test_makefile_anvil_down_uses_all_profiles(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        self.assertIsNotNone(
            re.search(
                r"^ANVIL_ALL_COMPOSE_ENV := \$\(ANVIL_COMPOSE_ENV\) COMPOSE_PROFILES=internal,host$",
                makefile,
                re.MULTILINE,
            )
        )

        target = re.search(r"^anvil-down:\n(?P<body>(?:\t.*\n)+)", makefile, re.MULTILINE)
        self.assertIsNotNone(target)
        body = target.group("body") if target else ""

        self.assertIn("$(ANVIL_ALL_COMPOSE_ENV)", body)
        self.assertIn(" down --volumes --remove-orphans", body)

    def test_internal_network_boundary(self) -> None:
        service = self.internal["services"]["anvil-internal"]

        self.assertNotIn("ports", service)
        self.assertEqual(sorted(service["networks"].keys()), ["anvil_internal"])
        self.assertIs(self.internal["networks"]["anvil_internal"]["internal"], True)

    def test_host_port_boundary(self) -> None:
        service = self.host["services"]["anvil-host"]

        self.assertEqual(
            service["ports"],
            [
                {
                    "mode": "ingress",
                    "host_ip": "127.0.0.1",
                    "target": 8545,
                    "published": "18545",
                    "protocol": "tcp",
                }
            ],
        )

        for service_config in self.all_profiles["services"].values():
            # TODO(silent-defaults): services without ports render as an empty
            # list here. The host service has an explicit assertion above; keep
            # this fallback only as a broad "no wildcard bind" sweep.
            for port in service_config.get("ports", []):
                self.assertNotEqual(port.get("host_ip"), "0.0.0.0")

    def test_runtime_posture(self) -> None:
        for service_name in ("anvil-internal", "anvil-host"):
            with self.subTest(service=service_name):
                service = self.all_profiles["services"][service_name]

                self.assertIs(service["read_only"], True)
                self.assertEqual(service["cap_drop"], ["ALL"])
                self.assertIn("no-new-privileges:true", service["security_opt"])
                self.assert_non_root_user(service["user"])
                self.assertEqual(service["pids_limit"], 256)
                self.assert_valid_mem_limit(service["mem_limit"])
                self.assertNotIn("volumes", service)
                self.assertNotIn("secrets", service)

    def assert_non_root_user(self, user: str) -> None:
        parts = user.split(":", 1)
        self.assertEqual(len(parts), 2)

        uid = int(parts[0])
        gid = int(parts[1])
        self.assertGreater(uid, 0)
        self.assertGreaterEqual(gid, 0)

    def assert_valid_mem_limit(self, mem_limit: object) -> None:
        if isinstance(mem_limit, int):
            self.assertGreater(mem_limit, 0)
            return

        self.assertIn(str(mem_limit), {"1073741824", "1g"})
