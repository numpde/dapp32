from __future__ import annotations

import unittest
from typing import Any

from .common import read_text, rendered_compose_config, repo_path


def service(config: dict[str, Any], name: str) -> dict[str, Any]:
    return config["services"][name]


def volume_for(config_service: dict[str, Any], target: str) -> dict[str, Any]:
    for volume in config_service.get("volumes", []):
        if volume["target"] == target:
            return volume
    raise AssertionError(f"missing volume target: {target}")


class RenderedComposePostureTest(unittest.TestCase):
    def assert_hardened(self, config_service: dict[str, Any]) -> None:
        self.assertEqual(True, config_service.get("read_only"))
        self.assertIn("no-new-privileges:true", config_service.get("security_opt", []))
        self.assertEqual(["ALL"], config_service.get("cap_drop"))
        self.assertNotEqual("0:0", config_service.get("user"))
        self.assertIn("pids_limit", config_service)
        self.assertIn("mem_limit", config_service)

    def test_bike_nft_local_deploy_lane_is_internal_and_secret_backed(self) -> None:
        config = rendered_compose_config(
            "compose/bike-nft-local.yml",
            env={
                "CAM_URI": "file:///work/dapps/bike-nft/cam/main.json",
                "BIKE_NFT_PRIVATE_KEY_FILE": "/tmp/bike-nft-private-key",
            },
        )
        anvil = service(config, "bike-nft-anvil")
        deploy = service(config, "deploy-bike-nft-local")

        self.assert_hardened(anvil)
        self.assert_hardened(deploy)
        self.assertNotIn("ports", anvil)
        self.assertNotIn("ports", deploy)
        self.assertEqual({"bike_nft_local": None}, anvil["networks"])
        self.assertEqual({"bike_nft_local": None}, deploy["networks"])
        self.assertTrue(config["networks"]["bike_nft_local"]["internal"])

        repo_mount = volume_for(deploy, "/work")
        self.assertEqual(True, repo_mount.get("read_only"))
        self.assertNotIn("PRIVATE_KEY", deploy.get("environment", {}))
        self.assertEqual("/tmp/bike-nft-private-key", config["secrets"]["bike_nft_private_key"]["file"])
        source_text = read_text(repo_path("compose/bike-nft-local.yml"))
        self.assertIn('export PRIVATE_KEY="$(cat /run/secrets/bike_nft_private_key)"', source_text)
        self.assertNotIn("$$(cat", source_text)

    def test_forge_lanes_render_as_offline_hardened_services(self) -> None:
        config = rendered_compose_config("compose/forge.yml")

        for name, config_service in config["services"].items():
            with self.subTest(service=name):
                self.assert_hardened(config_service)
                self.assertEqual("none", config_service.get("network_mode"))

        self.assertIn("*/script", " ".join(service(config, "forge-fmt")["command"]))
        self.assertIn("forge-script-build", config["services"])

    def test_package_lanes_render_as_offline_hardened_services(self) -> None:
        config = rendered_compose_config("compose/packages.yml")

        verify = service(config, "package-graph-check")
        build = service(config, "package-build")
        test = service(config, "package-test")
        for config_service in [verify, build, test]:
            self.assert_hardened(config_service)
            self.assertEqual("none", config_service.get("network_mode"))
            self.assertNotIn("HTTP_PROXY", config_service.get("environment", {}))
            self.assertNotIn("HTTPS_PROXY", config_service.get("environment", {}))

        self.assertEqual("/work/packages", verify.get("working_dir"))
        self.assertEqual("/work/packages", build.get("working_dir"))
        self.assertEqual("/work/packages", test.get("working_dir"))
        self.assertEqual(True, volume_for(verify, "/work/packages").get("read_only"))
        self.assertEqual(True, volume_for(build, "/work/packages").get("read_only"))
        for package_json in sorted(repo_path("packages").glob("*/package.json")):
            package_dir = package_json.parent.name
            self.assertNotEqual(
                True,
                volume_for(build, f"/work/packages/{package_dir}/dist").get("read_only", False),
            )
        self.assertEqual(True, volume_for(test, "/work/packages").get("read_only"))

    def test_viewer_terminal_renders_as_offline_read_only_interactive_lane(self) -> None:
        config = rendered_compose_config(
            "compose/viewer-terminal.yml",
            env={"VIEWER_TERMINAL_CONTAINER_NAME": "dapps-viewer-terminal-session"},
        )
        viewer = service(config, "viewer-terminal")

        self.assert_hardened(viewer)
        self.assertEqual("dapps-viewer-terminal-session", viewer.get("container_name"))
        self.assertEqual("none", viewer.get("network_mode"))
        self.assertEqual(True, viewer.get("stdin_open"))
        self.assertEqual(True, viewer.get("tty"))
        self.assertEqual(
            ["node", "--experimental-strip-types", "tools/viewer-terminal/terminal-session.ts"],
            viewer.get("command"),
        )
        for target in ["/work/dapps", "/work/packages", "/work/tools"]:
            self.assertEqual(True, volume_for(viewer, target).get("read_only"))
