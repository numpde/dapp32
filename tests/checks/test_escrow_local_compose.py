from __future__ import annotations

import re
import unittest

from .common import (
    compose_mapping,
    compose_sequence_or_empty,
    compose_service,
    read_text,
    rendered_compose_config,
    repo_path,
)


ESCROW_ENV = {
    "CAM_HASH": "0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66",
    "CAM_URI": "http://escrow-cam-http:8080/main.json",
    "CAM_VIEWER_RESOURCE_ORIGIN": "http://escrow-cam-http:8080",
    "ESCROW_BROADCAST_DIR": "/foundry-broadcast",
    "ESCROW_BROADCAST_PATH": "/foundry-broadcast/DeployEscrowLocal.s.sol/31337/run-latest.json",
    "ESCROW_GUI_BIND_HOST": "127.0.0.1",
    "ESCROW_GUI_ORIGIN": "http://127.0.0.1:5174",
    "ESCROW_GUI_PORT": "5174",
}

DEPLOY = "compose/escrow/local/deploy.yml"
HTTP = "compose/escrow/local/http.yml"
SCENARIO = "compose/escrow/local/scenario.yml"
TERMINAL = "compose/escrow/local/viewer-terminal.yml"
GUI = "compose/escrow/local/viewer-gui.yml"


class EscrowLocalComposeTest(unittest.TestCase):
    def test_vertical_scenario_has_no_host_exposure(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, SCENARIO), env=ESCROW_ENV)

        for service_name in (
            "escrow-anvil",
            "deploy-escrow-local",
            "escrow-cam-http",
            "escrow-local-scenario",
        ):
            with self.subTest(service=service_name):
                service = compose_service(config, service_name)
                self.assertEqual([], compose_sequence_or_empty(service, "ports"))
                self.assertFalse(service.get("privileged", False))
                self.assertTrue(service.get("read_only", False))
                self.assertIn("ALL", compose_sequence_or_empty(service, "cap_drop"))
                self.assertIn("no-new-privileges:true", compose_sequence_or_empty(service, "security_opt"))

        networks = config["networks"]
        self.assertTrue(networks["escrow_local"].get("internal", False))

    def test_only_broadcast_volume_is_writable_during_deployment(self) -> None:
        config = rendered_compose_config(DEPLOY, env=ESCROW_ENV)
        service = compose_service(config, "deploy-escrow-local")
        writable_targets = sorted(
            mount["target"]
            for mount in compose_sequence_or_empty(service, "volumes")
            if isinstance(mount, dict) and mount.get("read_only") is not True
        )
        self.assertEqual(["/foundry-broadcast"], writable_targets)

    def test_terminal_reuses_viewer_account_boundary(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, TERMINAL), env=ESCROW_ENV)
        terminal = compose_service(config, "escrow-viewer-terminal")
        self.assertEqual([], compose_sequence_or_empty(terminal, "ports"))
        self.assertEqual("local-rpc", compose_mapping(terminal, "environment")["CAM_VIEWER_BACKEND"])

        source = read_text(repo_path("js/tools/viewer-terminal/terminal-session.ts"))
        self.assertIn('case "account":', source)
        self.assertIn("session.setAccount", source)
        self.assertIn("account <address|none>", source)

    def test_browser_gateway_is_the_only_host_port(self) -> None:
        config = rendered_compose_config((DEPLOY, HTTP, GUI), env=ESCROW_ENV)
        exposed = {
            name: compose_sequence_or_empty(service, "ports")
            for name, service in config["services"].items()
            if compose_sequence_or_empty(service, "ports")
        }
        self.assertEqual({"escrow-browser-gateway"}, set(exposed))
        self.assertTrue(config["networks"]["escrow_local"].get("internal", False))

    def test_fixture_keys_are_obvious_local_only_values(self) -> None:
        source = read_text(repo_path(DEPLOY))
        keys = re.findall(r'0x([bcdf][a-f])\1{31}', source)
        self.assertEqual(["ba", "ca", "da", "fa"], keys)
        self.assertIn("local-only fixture value", source)

    def test_vertical_runner_uses_rendered_cam_actions(self) -> None:
        source = read_text(repo_path("js/tools/escrow-local-scenario/runner.ts"))
        self.assertIn("resolvedUiButtons", source)
        self.assertIn("session.dispatchAction", source)
        self.assertIn("simulateCamContractCall", source)
        self.assertIn("sendCamContractCall", source)
        self.assertIn("call.then.function", source)
        self.assertNotIn("encodeFunctionData", source)
        self.assertNotIn("escrow.writeContract", source)


if __name__ == "__main__":
    unittest.main()
