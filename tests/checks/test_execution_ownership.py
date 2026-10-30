"""Runtime grants for the common execution-ownership checker and formatter."""

import unittest

from .common import rendered_compose_config


class ExecutionOwnershipTest(unittest.TestCase):
    def services(self):
        return rendered_compose_config("compose/execution-check.yml")["services"]

    def test_checker_is_offline_and_has_no_host_writes_or_engine_authority(self):
        service = self.services()["execution-check"]
        self.assertEqual("none", service["network_mode"])
        self.assertTrue(service["read_only"])
        self.assertIn("ALL", service["cap_drop"])
        self.assertIn("no-new-privileges:true", service["security_opt"])
        self.assertNotEqual("0", service["user"].split(":")[0])
        self.assertFalse(service.get("ports"))
        self.assertFalse(service.get("secrets"))
        self.assertEqual(
            {"/input/js", "/work/js/node_modules", "/input/ops", "/input/execution-cases"},
            {volume["target"] for volume in service["volumes"]},
        )
        self.assertTrue(all(volume.get("read_only") for volume in service["volumes"]))
        self.assertEqual("local", service["environment"]["GOTOOLCHAIN"])
        self.assertEqual("off", service["environment"]["GOPROXY"])
        self.assertEqual("none", service["build"]["network"])

    def test_formatter_can_write_only_the_go_source_subtree(self):
        service = self.services()["execution-format"]
        self.assertEqual("none", service["network_mode"])
        self.assertTrue(service["read_only"])
        self.assertEqual(["gofmt", "-w", "cmd", "internal"], service["command"])
        self.assertEqual(["/work/ops"], [volume["target"] for volume in service["volumes"]])
        self.assertNotEqual(True, service["volumes"][0].get("read_only"))
        self.assertFalse(service.get("ports"))
        self.assertFalse(service.get("secrets"))
