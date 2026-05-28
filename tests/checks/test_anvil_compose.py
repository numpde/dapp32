from __future__ import annotations

import sys
import unittest
from typing import Any

from .common import compose_sequence, compose_service, rendered_compose_config


def setUpModule() -> None:
    print("Checking Anvil Compose posture...", file=sys.stderr, flush=True)


class AnvilComposePostureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.no_profile = cls.render_config("")
        cls.internal = cls.render_config("internal")
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

    def test_runtime_posture(self) -> None:
        for service_name in ("anvil-internal", "anvil-host"):
            with self.subTest(service=service_name):
                service = compose_service(self.all_profiles, service_name)

                self.assertIs(service["read_only"], True)
                self.assertEqual(service["cap_drop"], ["ALL"])
                self.assertIn("no-new-privileges:true", compose_sequence(service, "security_opt"))
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
