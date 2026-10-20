from __future__ import annotations

import unittest

from .common import compose_mapping, compose_sequence_or_empty, compose_service, rendered_compose_config

DEPLOY = "compose/pay-to-play/local/deploy.yml"
HTTP = "compose/pay-to-play/local/http.yml"
SCENARIO = "compose/pay-to-play/local/scenario.yml"
GUI = "compose/pay-to-play/local/viewer-gui.yml"
FIXTURE = "compose/pay-to-play/local/fixture.yml"
ENV = {
    "CAM_URI": "http://pay-to-play-cam-http:8080/main.json",
    "CAM_VIEWER_RESOURCE_ORIGIN": "http://pay-to-play-cam-http:8080",
    "PAY_TO_PLAY_BROADCAST_DIR": "/foundry-broadcast",
    "PAY_TO_PLAY_BROADCAST_PATH": "/foundry-broadcast/DeployPayToPlayLocal.s.sol/31337/run-latest.json",
    "PAY_TO_PLAY_GUI_BIND_HOST": "127.0.0.1",
    "PAY_TO_PLAY_GUI_ORIGIN": "http://127.0.0.1:5175",
    "PAY_TO_PLAY_GUI_PORT": "5175",
}


class PayToPlayLocalComposeTest(unittest.TestCase):
    def test_external_fixture_exports_without_host_ports_or_writable_inputs(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, FIXTURE), env=ENV)
        service = compose_service(config, "pay-to-play-fixture-info")
        self.assertIs(config["networks"]["pay-to-play_local"]["internal"], True)
        self.assertEqual(config["networks"]["pay-to-play_local"]["name"], service["environment"]["PAY_TO_PLAY_FIXTURE_NETWORK"])
        self.assertIs(service["read_only"], True)
        self.assertEqual("65532:65532", service["user"])
        self.assertIn("ALL", service["cap_drop"])
        self.assertIn("no-new-privileges:true", service["security_opt"])
        for name, peer in config["services"].items():
            with self.subTest(service=name):
                self.assertEqual([], compose_sequence_or_empty(peer, "ports"))
        self.assertTrue(all(mount["read_only"] for mount in service["volumes"]))

    def test_scenario_grants_only_internal_peers_and_readonly_inputs(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, SCENARIO), env=ENV)
        self.assertIs(config["networks"]["pay-to-play_local"]["internal"], True)
        for name, service in config["services"].items():
            with self.subTest(service=name):
                self.assertEqual([], compose_sequence_or_empty(service, "ports"))
                self.assertIs(service["read_only"], True)
                self.assertIn("ALL", compose_sequence_or_empty(service, "cap_drop"))
                self.assertIn("no-new-privileges:true", compose_sequence_or_empty(service, "security_opt"))
                self.assertGreater(int(service["pids_limit"]), 0)
                self.assertGreater(int(service["mem_limit"]), 0)
                writable = [mount["target"] for mount in compose_sequence_or_empty(service, "volumes") if mount.get("read_only") is not True]
                if name == "deploy-pay-to-play-local":
                    self.assertEqual(["/foundry-broadcast"], writable)
                else:
                    self.assertEqual([], writable)

    def test_deployment_reads_only_sources_manifest_and_locked_dependencies(self) -> None:
        service = compose_service(rendered_compose_config(DEPLOY, env=ENV), "deploy-pay-to-play-local")
        readonly = {mount["target"] for mount in service["volumes"] if mount.get("read_only") is True}
        self.assertEqual({
            "/work/dapps/foundry.toml", "/work/dapps/remappings.txt", "/work/dapps/dependencies",
            "/work/dapps/pay-to-play/src", "/work/dapps/pay-to-play/script",
            "/work/dapps/pay-to-play/cam/main.json", "/work/dapps/cam/src",
        }, readonly)
        self.assertNotIn("CAM_HASH", compose_mapping(service, "environment"))

    def test_gui_exposes_only_loopback_gateway(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, GUI), env=ENV)
        exposed = {name: service["ports"] for name, service in config["services"].items() if service.get("ports")}
        self.assertEqual({"pay-to-play-browser-gateway"}, set(exposed))
        port = exposed["pay-to-play-browser-gateway"][0]
        self.assertEqual("127.0.0.1", port["host_ip"])
        self.assertEqual("5175", port["published"])
        self.assertEqual(8080, port["target"])
