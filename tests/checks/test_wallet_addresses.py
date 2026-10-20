from __future__ import annotations

import unittest

from .common import rendered_compose_config


class WalletAddressesTest(unittest.TestCase):
    def test_secret_input_lane_is_offline_without_host_write_authority(self) -> None:
        services = rendered_compose_config("compose/cast.yml")["services"]
        for name in ("wallet-addresses", "wallet-addresses-check"):
            with self.subTest(service=name):
                service = services[name]
                self.assertEqual("none", service["network_mode"])
                self.assertTrue(service["read_only"])
                self.assertNotEqual("0", service["user"].split(":")[0])
                self.assertEqual(["ALL"], service["cap_drop"])
                self.assertIn("no-new-privileges:true", service["security_opt"])
                self.assertEqual("none", service["logging"]["driver"])
                # Compose omits zero-valued soft/hard fields in its JSON output.
                self.assertIn(service["ulimits"]["core"], ({}, {"hard": 0, "soft": 0}))
                self.assertEqual(service["mem_limit"], service["memswap_limit"])
                self.assertEqual(["/tmp:rw,nosuid,nodev,noexec,size=16m"], service["tmpfs"])
                self.assertFalse(service.get("secrets"))
                self.assertFalse(service.get("ports"))
                expected = {"/tool/wallet_addresses.sh"}
                if name.endswith("-check"):
                    expected.add("/tests/check.sh")
                self.assertEqual(expected, {mount["target"] for mount in service["volumes"]})
                for mount in service["volumes"]:
                    self.assertEqual("bind", mount["type"])
                    self.assertTrue(mount["read_only"])
                    self.assertIn(mount["bind"], ({}, {"create_host_path": False}))
        self.assertTrue(services["wallet-addresses"]["stdin_open"])
        self.assertTrue(services["wallet-addresses"]["tty"])
