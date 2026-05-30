from __future__ import annotations

import unittest
from typing import Any

from ..common import (
    compose_command_text,
    compose_mapping,
    compose_sequence,
    compose_sequence_or_empty,
    compose_service,
    compose_volume,
    read_text,
    rendered_compose_config,
    repo_path,
)


BIKE_CAM_HTTP_ORIGIN = "http://bike-nft-cam-http:8080"
BIKE_CAM_URI = f"{BIKE_CAM_HTTP_ORIGIN}/main.json"
STANDALONE_BIKE_CAM_URI = "https://example.test/bike-nft/main.json"
ANVIL_DEV_PRIVATE_KEY = "0xbabababababababababababababababababababababababababababababababa"
PYTHON_ALPINE_IMAGE = "docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc"
PACKAGE_WORKSPACE_TMPFS = "/work/js:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=1777"
ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"
VIEWER_TERMINAL_CONTAINER_NAME = "dapps-viewer-terminal-session"
BIKE_NFT_BROADCAST_DIR = "/foundry-broadcast"
BIKE_NFT_BROADCAST_PATH = f"{BIKE_NFT_BROADCAST_DIR}/DeployBikeNftLocal.s.sol/31337/run-latest.json"
BIKE_NFT_VIEWER_TERMINAL_COMPOSE = (
    "compose/bike-nft/local/deploy.yml",
    "compose/bike-nft/local/http.yml",
    "compose/bike-nft/local/viewer-terminal.yml",
)
BIKE_NFT_VIEWER_GUI_COMPOSE = (
    "compose/bike-nft/local/deploy.yml",
    "compose/bike-nft/local/http.yml",
    "compose/bike-nft/local/viewer-gui.yml",
)


def standalone_bike_fixture_env() -> dict[str, str]:
    return {
        "CAM_URI": STANDALONE_BIKE_CAM_URI,
        "CAM_HASH": ZERO_HASH,
        "BIKE_NFT_BROADCAST_DIR": BIKE_NFT_BROADCAST_DIR,
        "BIKE_NFT_BROADCAST_PATH": BIKE_NFT_BROADCAST_PATH,
    }


def bike_viewer_fixture_env() -> dict[str, str]:
    return {
        "CAM_URI": BIKE_CAM_URI,
        "CAM_HASH": ZERO_HASH,
        "CAM_VIEWER_RESOURCE_ORIGIN": BIKE_CAM_HTTP_ORIGIN,
        "BIKE_NFT_BROADCAST_DIR": BIKE_NFT_BROADCAST_DIR,
        "BIKE_NFT_BROADCAST_PATH": BIKE_NFT_BROADCAST_PATH,
    }


def mock_viewer_env() -> dict[str, str]:
    return {
        "CAM_VIEWER_MOCK": "bike-nft",
        "VIEWER_TERMINAL_CONTAINER_NAME": VIEWER_TERMINAL_CONTAINER_NAME,
    }


class RenderedComposePostureTest(unittest.TestCase):
    def assert_hardened(self, config_service: dict[str, Any]) -> None:
        self.assertEqual(True, config_service["read_only"])
        self.assertIn("no-new-privileges:true", compose_sequence(config_service, "security_opt"))
        self.assertEqual(["ALL"], config_service["cap_drop"])
        self.assertNotEqual("0:0", config_service["user"])
        self.assertIn("pids_limit", config_service)
        self.assertIn("mem_limit", config_service)

    def assert_no_published_ports(self, *config_services: dict[str, Any]) -> None:
        for config_service in config_services:
            self.assertNotIn("ports", config_service)

    def assert_loopback_port(self, config_service: dict[str, Any], target: int, published: str) -> None:
        ports = compose_sequence(config_service, "ports")
        self.assertIn(
            {
                "mode": "ingress",
                "host_ip": "127.0.0.1",
                "target": target,
                "published": published,
                "protocol": "tcp",
            },
            ports,
        )

    def assert_internal_network(
        self,
        config: dict[str, Any],
        network_name: str,
        *config_services: dict[str, Any],
    ) -> None:
        self.assertTrue(config["networks"][network_name]["internal"])
        for config_service in config_services:
            self.assertEqual({network_name: None}, config_service["networks"])

    def assert_local_network(
        self,
        config: dict[str, Any],
        network_name: str,
        *config_services: dict[str, Any],
    ) -> None:
        self.assertFalse(config["networks"][network_name].get("internal", False))
        for config_service in config_services:
            self.assertEqual({network_name: None}, config_service["networks"])

    def assert_networks(self, config_service: dict[str, Any], *network_names: str) -> None:
        self.assertEqual({network_name: None for network_name in network_names}, config_service["networks"])

    def assert_no_volume_target(self, config_service: dict[str, Any], target: str) -> None:
        self.assertNotIn(target, [volume["target"] for volume in compose_sequence_or_empty(config_service, "volumes")])

    def assert_read_only_volumes(self, config_service: dict[str, Any], *targets: str) -> None:
        for target in targets:
            self.assertEqual(True, compose_volume(config_service, target).get("read_only"))

    def assert_staged_package_workspace(self, config_service: dict[str, Any]) -> None:
        self.assert_read_only_volumes(config_service, "/input/js", "/work/js/node_modules")
        self.assertIn(PACKAGE_WORKSPACE_TMPFS, compose_sequence(config_service, "tmpfs"))
        self.assertIn("run-js-workspace", compose_command_text(config_service))

    def assert_local_rpc_viewer_environment(self, config_service: dict[str, Any]) -> None:
        environment = compose_mapping(config_service, "environment")
        self.assertEqual("local-rpc", environment["CAM_VIEWER_BACKEND"])
        self.assertEqual("true", environment["CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH"])
        self.assertEqual("http://bike-nft-anvil:8545", environment["CAM_VIEWER_RPC_URL"])
        self.assertEqual(
            BIKE_NFT_BROADCAST_PATH,
            environment["CAM_VIEWER_BROADCAST_PATH"],
        )
        self.assertEqual(BIKE_CAM_HTTP_ORIGIN, environment["CAM_VIEWER_RESOURCE_ORIGIN"])
        self.assertEqual("{}", environment["CAM_VIEWER_INITIAL_PARAMS_JSON"])
        self.assertNotIn("CAM_VIEWER_FILE_ROOT", environment)
        self.assertNotIn("PRIVATE_KEY", environment)

    def test_bike_nft_local_deploy_lane_is_internal_and_fixture_keyed(self) -> None:
        config = rendered_compose_config(
            "compose/bike-nft/local/deploy.yml",
            env=standalone_bike_fixture_env(),
        )
        anvil = compose_service(config, "bike-nft-anvil")
        deploy = compose_service(config, "deploy-bike-nft-local")

        self.assert_hardened(anvil)
        self.assert_hardened(deploy)
        self.assert_no_published_ports(anvil, deploy)
        self.assert_internal_network(config, "bike_nft_local", anvil, deploy)

        for target in [
            "/work/dapps/foundry.toml",
            "/work/dapps/remappings.txt",
            "/work/dapps/dependencies",
            "/work/dapps/bike-nft",
            "/work/dapps/cam",
        ]:
            self.assertEqual(True, compose_volume(deploy, target).get("read_only"))
        self.assert_no_volume_target(deploy, "/work")
        self.assertNotIn("secrets", config)
        self.assertEqual(ANVIL_DEV_PRIVATE_KEY, compose_mapping(deploy, "environment")["PRIVATE_KEY"])
        source_text = read_text(repo_path("compose/bike-nft/local/deploy.yml"))
        self.assertIn("Public Anvil default account private key", source_text)
        self.assertNotIn("/run/secrets", source_text)
        self.assertNotIn("$$(cat", source_text)

    def test_forge_lanes_render_as_offline_hardened_services(self) -> None:
        config = rendered_compose_config("compose/forge.yml")

        for name, config_service in config["services"].items():
            with self.subTest(service=name):
                self.assert_hardened(config_service)
                self.assertEqual("none", config_service.get("network_mode"))

        self.assertIn("*/script", compose_command_text(compose_service(config, "forge-fmt")))
        self.assertIn("forge-script-build", config["services"])
        forge_abi = compose_service(config, "forge-abi")
        self.assertEqual(True, compose_volume(forge_abi, "/work/dapps").get("read_only"))
        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "src").is_dir() and (dapp_dir / "cam").is_dir():
                abi_mount = compose_volume(forge_abi, f"/work/dapps/{dapp_dir.name}/cam/abi")
                # Intentional default: Docker bind mounts are writable when
                # read_only is omitted. Treat both false and absent as the
                # explicit ABI materialization boundary this test is checking.
                self.assertIsNot(abi_mount.get("read_only"), True)

    def test_writable_host_binds_are_explicit_materialization_outputs(self) -> None:
        expected = {
            ("compose/forge.yml", "forge-abi-plan", "/tmp/abi-plan", "/work/abi-plan"),
            ("compose/deps.yml", "soldeer-apply-locked", str(repo_path("dapps/dependencies")), "/work/dependencies"),
            ("compose/deps.yml", "soldeer-apply-update", str(repo_path("dapps/dependencies")), "/work/dependencies"),
            ("compose/deps.yml", "soldeer-apply-update", str(repo_path("dapps/soldeer.lock")), "/work/soldeer.lock"),
            ("compose/deps.yml", "soldeer-apply-update", str(repo_path("dapps/remappings.txt")), "/work/remappings.txt"),
            (
                "compose/deps.yml",
                "soldeer-apply-update",
                str(repo_path("dapps/dependency-checksums.txt")),
                "/work/dependency-checksums.txt",
            ),
            ("compose/package-deps.yml", "package-apply-locked", str(repo_path("js/node_modules")), "/work/node_modules"),
            ("compose/package-deps.yml", "package-apply-update", str(repo_path("js/node_modules")), "/work/node_modules"),
            (
                "compose/package-deps.yml",
                "package-apply-update",
                str(repo_path("js/package-lock.json")),
                "/work/package-lock.json",
            ),
        }

        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "src").is_dir() and (dapp_dir / "cam").is_dir():
                expected.add(
                    (
                        "compose/forge.yml",
                        "forge-abi",
                        str(dapp_dir / "cam" / "abi"),
                        f"/work/dapps/{dapp_dir.name}/cam/abi",
                    )
                )

        actual = set()
        for compose_file in [
            "compose/anvil.yml",
            "compose/bike-nft/local/deploy.yml",
            "compose/bike-nft/local/http.yml",
            BIKE_NFT_VIEWER_TERMINAL_COMPOSE,
            "compose/cast.yml",
            "compose/checks.yml",
            "compose/deps.yml",
            "compose/forge.yml",
            "compose/package-deps.yml",
            "compose/packages.yml",
            "compose/viewer-terminal.yml",
        ]:
            config = rendered_compose_config(
                compose_file,
                env={
                    "PACKAGE_INPUT_DIR": "/tmp/package-input",
                    "RPC_URL_FILE": "/tmp/rpc-url",
                    **bike_viewer_fixture_env(),
                    **mock_viewer_env(),
                },
            )
            for service_name, config_service in config["services"].items():
                for volume in compose_sequence_or_empty(config_service, "volumes"):
                    # Intentional default: rendered bind mounts without an
                    # explicit read_only flag are Docker-writable by default,
                    # so missing read_only is intentionally classified here as
                    # a writable host bind.
                    if volume.get("type") == "bind" and volume.get("read_only") is not True:
                        actual.add((compose_file, service_name, volume["source"], volume["target"]))

        self.assertEqual(expected, actual)

    def test_package_and_viewer_lanes_render_as_offline_hardened_services(self) -> None:
        config = rendered_compose_config("compose/packages.yml")

        verify = compose_service(config, "package-graph-check")
        build = compose_service(config, "package-build-check")
        test = compose_service(config, "package-test")
        self.assertNotIn("package-ci", config["services"])
        for config_service in [verify, build, test]:
            self.assert_hardened(config_service)
            self.assertEqual("none", config_service.get("network_mode"))
            self.assertEqual("/work/js", config_service.get("working_dir"))
            self.assertNotIn("HTTP_PROXY", compose_mapping(config_service, "environment"))
            self.assertNotIn("HTTPS_PROXY", compose_mapping(config_service, "environment"))
            self.assert_staged_package_workspace(config_service)

        self.assert_read_only_volumes(test, "/work/dapps", "/work/tests/fixtures")

        viewer_config = rendered_compose_config(
            BIKE_NFT_VIEWER_TERMINAL_COMPOSE,
            env=bike_viewer_fixture_env(),
        )
        cam_http = compose_service(viewer_config, "bike-nft-cam-http")
        viewer = compose_service(viewer_config, "bike-nft-viewer-terminal")
        deploy = compose_service(viewer_config, "deploy-bike-nft-local")

        self.assert_hardened(cam_http)
        self.assert_hardened(viewer)
        self.assert_hardened(deploy)
        self.assertNotIn("build", cam_http)
        self.assertEqual(PYTHON_ALPINE_IMAGE, cam_http["image"])
        self.assert_no_published_ports(cam_http, viewer, deploy)
        self.assert_internal_network(viewer_config, "bike_nft_local", cam_http, viewer)
        self.assertEqual("service_completed_successfully", viewer["depends_on"]["deploy-bike-nft-local"]["condition"])
        self.assertEqual("service_healthy", viewer["depends_on"]["bike-nft-cam-http"]["condition"])
        self.assertNotIn("bike-nft-runtime-volume-init", viewer_config["services"])

        self.assert_local_rpc_viewer_environment(viewer)

        deploy_environment = compose_mapping(deploy, "environment")
        self.assertEqual(BIKE_CAM_URI, deploy_environment["CAM_URI"])
        self.assertEqual(ZERO_HASH, deploy_environment["CAM_HASH"])
        self.assertEqual(BIKE_NFT_BROADCAST_DIR, deploy_environment["FOUNDRY_BROADCAST"])
        self.assertEqual(ANVIL_DEV_PRIVATE_KEY, deploy_environment["PRIVATE_KEY"])
        self.assertIn("anvil_setBalance", compose_command_text(deploy))

        self.assert_read_only_volumes(cam_http, "/srv/cam")
        self.assertIn("python3 -I -B -m http.server", compose_command_text(cam_http))
        self.assert_no_volume_target(viewer, "/work/dapps")
        self.assert_no_volume_target(viewer, "/out")
        self.assert_staged_package_workspace(viewer)
        self.assert_read_only_volumes(viewer, "/foundry-broadcast")
        deploy_broadcast = compose_volume(deploy, "/foundry-broadcast")
        viewer_broadcast = compose_volume(viewer, "/foundry-broadcast")
        self.assertEqual("volume", deploy_broadcast["type"])
        self.assertEqual("volume", viewer_broadcast["type"])
        self.assertEqual("bike_nft_broadcast", deploy_broadcast["source"])
        self.assertEqual("bike_nft_broadcast", viewer_broadcast["source"])
        self.assertFalse(viewer_config["volumes"]["bike_nft_broadcast"].get("external", False))

        command = compose_command_text(viewer)
        self.assertIn("npm run build:packages", command)
        self.assertIn("node --experimental-strip-types tools/viewer-terminal/terminal-session.ts", command)

    def test_bike_nft_local_gui_viewer_is_gatewayed_and_read_only(self) -> None:
        config = rendered_compose_config(
            BIKE_NFT_VIEWER_GUI_COMPOSE,
            env={
                "CAM_URI": "http://127.0.0.1:5173/cam/main.json",
                "CAM_HASH": ZERO_HASH,
                "BIKE_NFT_BROADCAST_DIR": BIKE_NFT_BROADCAST_DIR,
                "BIKE_NFT_BROADCAST_PATH": BIKE_NFT_BROADCAST_PATH,
            },
        )

        anvil = compose_service(config, "bike-nft-anvil")
        cam_http = compose_service(config, "bike-nft-cam-http")
        cam_web = compose_service(config, "cam-web")
        deploy = compose_service(config, "deploy-bike-nft-local")
        gateway = compose_service(config, "bike-nft-browser-gateway")
        viewer_url = compose_service(config, "bike-nft-viewer-url")

        self.assert_hardened(anvil)
        self.assert_hardened(cam_http)
        self.assert_hardened(cam_web)
        self.assert_hardened(deploy)
        self.assert_hardened(gateway)
        self.assert_hardened(viewer_url)
        self.assert_internal_network(config, "bike_nft_local", anvil, cam_http, cam_web, deploy)
        self.assert_local_network(config, "bike_nft_browser")
        self.assert_networks(gateway, "bike_nft_browser", "bike_nft_local")
        self.assertEqual("none", viewer_url["network_mode"])
        self.assert_no_published_ports(anvil, cam_http, cam_web, deploy, viewer_url)
        self.assert_loopback_port(gateway, 8080, "5173")

        self.assert_staged_package_workspace(cam_web)
        self.assert_no_volume_target(cam_web, "/work/dapps")
        self.assert_no_volume_target(cam_web, "/foundry-broadcast")
        self.assertNotIn("PRIVATE_KEY", compose_mapping(cam_web, "environment"))
        self.assertNotIn("CAM_VIEWER_BROADCAST_PATH", compose_mapping(cam_web, "environment"))
        self.assertEqual("volume", compose_volume(deploy, "/foundry-broadcast")["type"])
        self.assertEqual("volume", compose_volume(viewer_url, "/foundry-broadcast")["type"])
        self.assert_read_only_volumes(viewer_url, "/foundry-broadcast")
        self.assertFalse(config["volumes"]["bike_nft_broadcast"].get("external", False))
        self.assertIn("run-js-workspace", compose_command_text(cam_web))
        self.assertIn("npm run build:packages", compose_command_text(cam_web))
        self.assertIn("npm run dev -w cam-web", compose_command_text(cam_web))
        gateway_command = compose_command_text(gateway)
        self.assertIn("proxy_pass http://cam-web:5173", gateway_command)
        self.assertIn("proxy_pass http://bike-nft-anvil:8545", gateway_command)
        self.assertIn("proxy_pass http://bike-nft-cam-http:8080", gateway_command)
        self.assertIn("http://127.0.0.1:5173/rpc", compose_mapping(viewer_url, "environment")["RPC_URL"])
