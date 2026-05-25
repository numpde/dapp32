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
        forge_abi = service(config, "forge-abi")
        self.assertEqual(True, volume_for(forge_abi, "/work/dapps").get("read_only"))
        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "src").is_dir() and (dapp_dir / "cam").is_dir():
                abi_mount = volume_for(forge_abi, f"/work/dapps/{dapp_dir.name}/cam/abi")
                self.assertNotEqual(True, abi_mount.get("read_only", False))

    def test_writable_host_binds_are_explicit_materialization_outputs(self) -> None:
        expected = {
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
            ("compose/package-deps.yml", "package-apply-locked", str(repo_path("packages/node_modules")), "/work/node_modules"),
            ("compose/package-deps.yml", "package-apply-update", str(repo_path("packages/node_modules")), "/work/node_modules"),
            (
                "compose/package-deps.yml",
                "package-apply-update",
                str(repo_path("packages/package-lock.json")),
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
            "compose/bike-nft-local.yml",
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
                    "CAM_URI": "file:///work/dapps/bike-nft/cam/main.json",
                    "BIKE_NFT_PRIVATE_KEY_FILE": "/tmp/bike-nft-private-key",
                    "PACKAGE_INPUT_DIR": "/tmp/package-input",
                    "RPC_URL_FILE": "/tmp/rpc-url",
                    "VIEWER_TERMINAL_CONTAINER_NAME": "dapps-viewer-terminal-session",
                },
            )
            for service_name, config_service in config["services"].items():
                for volume in config_service.get("volumes", []):
                    if volume.get("type") == "bind" and not volume.get("read_only", False):
                        actual.add((compose_file, service_name, volume["source"], volume["target"]))

        self.assertEqual(expected, actual)

    def test_package_lanes_render_as_offline_hardened_services(self) -> None:
        config = rendered_compose_config("compose/packages.yml")

        verify = service(config, "package-graph-check")
        build = service(config, "package-build-check")
        test = service(config, "package-test")
        self.assertNotIn("package-ci", config["services"])
        for config_service in [verify, build, test]:
            self.assert_hardened(config_service)
            self.assertEqual("none", config_service.get("network_mode"))
            self.assertNotIn("HTTP_PROXY", config_service.get("environment", {}))
            self.assertNotIn("HTTPS_PROXY", config_service.get("environment", {}))

        self.assertEqual("/work/packages", verify.get("working_dir"))
        self.assertEqual("/work/packages", build.get("working_dir"))
        self.assertEqual("/work/packages", test.get("working_dir"))
        for config_service in [verify, build, test]:
            self.assertEqual(True, volume_for(config_service, "/input/packages").get("read_only"))
            self.assertIn("/work/packages:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=1777", config_service.get("tmpfs", []))
            command = " ".join(config_service.get("command", []))
            self.assertIn("stage-package-workspace /input/packages /work/packages", command)

        self.assertEqual(True, volume_for(test, "/work/dapps").get("read_only"))

    def test_viewer_terminal_renders_as_offline_read_only_interactive_lane(self) -> None:
        config = rendered_compose_config(
            "compose/viewer-terminal.yml",
            env={"VIEWER_TERMINAL_CONTAINER_NAME": "dapps-viewer-terminal-session"},
        )
        viewer = service(config, "viewer-terminal")
        check = service(config, "viewer-terminal-check")

        self.assert_hardened(viewer)
        self.assert_hardened(check)
        self.assertEqual("dapps-viewer-terminal-session", viewer.get("container_name"))
        self.assertEqual("none", viewer.get("network_mode"))
        self.assertEqual("none", check.get("network_mode"))
        self.assertEqual(True, viewer.get("stdin_open"))
        self.assertEqual(True, viewer.get("tty"))
        self.assertIn("npm run build:packages", " ".join(viewer.get("command", [])))
        self.assertIn("node --experimental-strip-types tools/viewer-terminal/terminal-session.ts", " ".join(viewer.get("command", [])))
        self.assertIn("npm run build:packages", " ".join(check.get("command", [])))
        self.assertIn("tsc -p ../tools/viewer-terminal/tsconfig.json", " ".join(check.get("command", [])))
        self.assertIn("node --experimental-strip-types tools/viewer-terminal/terminal-session.ts", " ".join(check.get("command", [])))
        for target in ["/work/dapps", "/work/tools"]:
            self.assertEqual(True, volume_for(viewer, target).get("read_only"))
            self.assertEqual(True, volume_for(check, target).get("read_only"))
        self.assertEqual(True, volume_for(viewer, "/input/packages").get("read_only"))
        self.assertEqual(True, volume_for(check, "/input/packages").get("read_only"))
        self.assertIn("/work/packages:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=1777", viewer.get("tmpfs", []))
        self.assertIn("/work/packages:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=1777", check.get("tmpfs", []))
        self.assertIn("stage-package-workspace /input/packages /work/packages", " ".join(viewer.get("command", [])))
        self.assertIn("stage-package-workspace /input/packages /work/packages", " ".join(check.get("command", [])))
