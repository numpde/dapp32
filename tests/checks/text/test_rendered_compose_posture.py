from __future__ import annotations

import os
import re
import subprocess
import unittest
from typing import Any

from ..common import (
    RENDERED_COMPOSE_FIXTURE_ENV,
    compose_command_text,
    compose_mapping,
    compose_sequence,
    compose_sequence_or_empty,
    compose_service,
    compose_volume,
    docker_compose_command,
    read_text,
    rendered_compose_config,
    repo_path,
)


BIKE_CAM_HTTP_ORIGIN = "http://bike-nft-cam-http:8080"
BIKE_CAM_URI = f"{BIKE_CAM_HTTP_ORIGIN}/main.json"
BIKE_NFT_GUI_BIND_HOST = "127.0.0.1"
BIKE_NFT_GUI_ORIGIN = "http://127.0.0.1:5173"
STANDALONE_BIKE_CAM_URI = "https://example.test/bike-nft/main.json"
ANVIL_DEV_PRIVATE_KEY = "0xbabababababababababababababababababababababababababababababababa"
PYTHON_ALPINE_IMAGE = "docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc"
PACKAGE_WORKSPACE_TMPFS = "/work/js:rw,exec,nosuid,nodev,size=512m,uid=1000,gid=1000,mode=1777"
ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000"
VIEWER_TERMINAL_CONTAINER_NAME = "dapps-viewer-terminal-session"
BIKE_MOCK_CAM_MOUNT = "/work/cam/bike-nft"
BIKE_NFT_BROADCAST_DIR = "/foundry-broadcast"
BIKE_NFT_BROADCAST_PATH = f"{BIKE_NFT_BROADCAST_DIR}/DeployBikeNftLocal.s.sol/31337/run-latest.json"
REQUIRED_COMPOSE_ENV_RE = re.compile(r"\$\{(?P<name>[A-Za-z_][A-Za-z0-9_]*):\?[^}]+\}")
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
BIKE_NFT_TEST_INTEGRATION_FUZZ_COMPOSE = (
    "compose/bike-nft/local/deploy.yml",
    "compose/bike-nft/local/http.yml",
    "compose/bike-nft/local/test-integration-fuzz.yml",
)
CHECK_LIVE_DEPS_EGRESS_COMPOSE = (
    "compose/deps.yml",
    "compose/check-live-deps-egress.yml",
)
OVERLAY_ONLY_COMPOSE_FILES = {
    "compose/bike-nft/local/test-integration-fuzz.yml",
    "compose/bike-nft/local/viewer-gui.yml",
    "compose/bike-nft/local/viewer-terminal.yml",
    "compose/check-live-deps-egress.yml",
}


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


def integration_fuzz_env() -> dict[str, str]:
    return {
        "CAM_INTEGRATION_DESCRIPTOR_HOST_PATH": "/tmp/cam-integration.json",
        "CAM_INTEGRATION_NETWORK": "dapps-test-network",
        "CAM_INTEGRATION_SEED": "test-seed",
        "CAM_INTEGRATION_RUNS": "1",
        "CAM_INTEGRATION_STEPS": "16",
    }


def bike_integration_fuzz_env() -> dict[str, str]:
    return {
        **bike_viewer_fixture_env(),
        "CAM_INTEGRATION_SEED": "test-seed",
        "CAM_INTEGRATION_RUNS": "1",
        "CAM_INTEGRATION_STEPS": "16",
    }


def compose_files() -> tuple[str, ...]:
    return tuple(
        path.relative_to(repo_path(".")).as_posix()
        for path in sorted((*repo_path("compose").rglob("*.yml"), *repo_path("compose").rglob("*.yaml")))
    )


def compose_render_units() -> tuple[str | tuple[str, ...], ...]:
    standalone_units = tuple(
        compose_file
        for compose_file in compose_files()
        if compose_file not in OVERLAY_ONLY_COMPOSE_FILES
    )
    return (
        *standalone_units,
        BIKE_NFT_VIEWER_TERMINAL_COMPOSE,
        BIKE_NFT_VIEWER_GUI_COMPOSE,
        BIKE_NFT_TEST_INTEGRATION_FUZZ_COMPOSE,
        CHECK_LIVE_DEPS_EGRESS_COMPOSE,
    )


def compose_files_with_required_env() -> tuple[str, ...]:
    return tuple(
        compose_file
        for compose_file in compose_files()
        if required_compose_env_names(compose_file)
    )


def compose_required_env_render_units() -> tuple[str | tuple[str, ...], ...]:
    return tuple(
        compose_unit
        for compose_unit in compose_render_units()
        if required_compose_env_names(compose_unit)
    )


def compose_unit_files(compose_unit: str | tuple[str, ...]) -> tuple[str, ...]:
    if isinstance(compose_unit, str):
        return (compose_unit,)
    return compose_unit


def required_compose_env_names(compose_file: str | tuple[str, ...]) -> tuple[str, ...]:
    names: set[str] = set()
    for file in compose_unit_files(compose_file):
        names.update(REQUIRED_COMPOSE_ENV_RE.findall(read_text(repo_path(file))))

    return tuple(sorted(names))


def compose_render_env() -> dict[str, str]:
    render_env = os.environ.copy()
    render_env.update(RENDERED_COMPOSE_FIXTURE_ENV)
    render_env.update({
        **standalone_bike_fixture_env(),
        **bike_viewer_fixture_env(),
        **mock_viewer_env(),
        **integration_fuzz_env(),
        "BIKE_NFT_GUI_ORIGIN": BIKE_NFT_GUI_ORIGIN,
        "PACKAGE_INPUT_DIR": "/tmp/package-input",
        "RPC_URL_FILE": "/tmp/rpc-url",
    })
    return render_env


def compose_config_process(
    compose_file: str | tuple[str, ...],
    render_env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    command = docker_compose_command(render_env)
    for file in compose_unit_files(compose_file):
        command.extend(["-f", str(repo_path(file))])
    command.extend(["config", "--format", "json"])

    return subprocess.run(
        command,
        cwd=repo_path("."),
        env=render_env,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


class RenderedComposePostureTest(unittest.TestCase):
    def test_rendered_compose_fixture_env_is_explicit(self) -> None:
        # This pins the happy-path render fixture so posture tests do not gain
        # hidden environment inputs. It is deliberately not the fail-closed
        # check for missing operator variables.
        self.assertEqual(
            {
                "ABI_PLAN_DIR": "/tmp/abi-plan",
                "ALLOW_UPDATE": "0",
                "ANVIL_HOST_PORT": "8545",
                "BIKE_NFT_GUI_BIND_HOST": "127.0.0.1",
                "BIKE_NFT_GUI_PORT": "5173",
                "COMPOSE_PROJECT_NAME": "dapps-check",
                "LOCAL_GID": "1000",
                "LOCAL_UID": "1000",
            },
            RENDERED_COMPOSE_FIXTURE_ENV,
        )

    def test_required_compose_env_vars_fail_closed_when_omitted(self) -> None:
        required_files = set(compose_files_with_required_env())
        covered_files = {
            file
            for compose_unit in compose_required_env_render_units()
            for file in compose_unit_files(compose_unit)
        }
        self.assertEqual(required_files, required_files & covered_files)

        for compose_unit in compose_required_env_render_units():
            baseline = compose_config_process(compose_unit, compose_render_env())
            self.assertEqual(0, baseline.returncode, baseline.stderr + baseline.stdout)

            required_names = required_compose_env_names(compose_unit)
            for missing_name in required_names:
                with self.subTest(compose_unit=compose_unit, missing=missing_name):
                    render_env = compose_render_env()
                    self.assertIn(missing_name, render_env)
                    del render_env[missing_name]
                    result = compose_config_process(compose_unit, render_env)

                    self.assertNotEqual(
                        0,
                        result.returncode,
                        f"Compose render unexpectedly succeeded without {missing_name}",
                    )
                    self.assertIn(missing_name, result.stderr + result.stdout)

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

    def assert_published_port(
        self,
        config_service: dict[str, Any],
        *,
        host_ip: str,
        target: int,
        published: str,
    ) -> None:
        ports = compose_sequence(config_service, "ports")
        self.assertIn(
            {
                "mode": "ingress",
                "host_ip": host_ip,
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
        network = config["networks"][network_name]
        if "internal" in network:
            self.assertFalse(network["internal"])
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

    def assert_mock_viewer_terminal(self, config_service: dict[str, Any]) -> None:
        self.assert_hardened(config_service)
        self.assertEqual("none", config_service.get("network_mode"))
        self.assert_staged_package_workspace(config_service)
        self.assert_read_only_volumes(config_service, BIKE_MOCK_CAM_MOUNT, "/work/tests/fixtures")
        self.assert_no_volume_target(config_service, "/work/dapps")

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
        self.assertEqual("{}", environment["CAM_VIEWER_INITIAL_INPUTS_JSON"])
        self.assertNotIn("CAM_VIEWER_FILE_ROOT", environment)
        self.assertNotIn("PRIVATE_KEY", environment)

    def assert_bike_broadcast_volume_shared(
        self,
        config: dict[str, Any],
        writer_service: dict[str, Any],
        reader_service: dict[str, Any],
    ) -> None:
        writer_broadcast = compose_volume(writer_service, BIKE_NFT_BROADCAST_DIR)
        reader_broadcast = compose_volume(reader_service, BIKE_NFT_BROADCAST_DIR)
        self.assertEqual("volume", writer_broadcast["type"])
        self.assertEqual("volume", reader_broadcast["type"])
        self.assertEqual("bike_nft_broadcast", writer_broadcast["source"])
        self.assertEqual("bike_nft_broadcast", reader_broadcast["source"])
        broadcast_volume = config["volumes"]["bike_nft_broadcast"]
        if "external" in broadcast_volume:
            self.assertFalse(broadcast_volume["external"])

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
        self.assertNotIn("forge-abi-plan", config["services"])
        self.assertNotIn("forge-abi", config["services"])

        abi_config = rendered_compose_config("compose/forge-abi.yml")
        for name, config_service in abi_config["services"].items():
            with self.subTest(service=name):
                self.assert_hardened(config_service)
                self.assertEqual("none", config_service.get("network_mode"))

        forge_abi = compose_service(abi_config, "forge-abi")
        self.assertEqual(True, compose_volume(forge_abi, "/work/dapps").get("read_only"))
        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "src").is_dir() and (dapp_dir / "cam").is_dir():
                abi_mount = compose_volume(forge_abi, f"/work/dapps/{dapp_dir.name}/cam/abi")
                # Intentional default: Docker bind mounts are writable when
                # read_only is omitted. Treat both false and absent as the
                # explicit ABI materialization boundary this test is checking.
                self.assertIsNot(abi_mount.get("read_only"), True)

        cam_config = rendered_compose_config("compose/cam.yml")
        cam_integrity = compose_service(cam_config, "cam-integrity")
        self.assert_hardened(cam_integrity)
        self.assertEqual("none", cam_integrity.get("network_mode"))
        self.assertEqual(True, compose_volume(cam_integrity, "/work/dapps").get("read_only"))
        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "cam" / "main.json").is_file():
                manifest_mount = compose_volume(cam_integrity, f"/work/dapps/{dapp_dir.name}/cam/main.json")
                # Intentional default: this is the one CAM integrity lane
                # output. The broader dapps tree stays read-only above.
                self.assertIsNot(manifest_mount.get("read_only"), True)

    def test_writable_host_binds_are_explicit_materialization_outputs(self) -> None:
        expected = {
            ("compose/forge-abi.yml", "forge-abi-plan", "/tmp/abi-plan", "/work/abi-plan"),
            ("compose/package-deps.yml", "package-apply-locked", str(repo_path("js/node_modules")), "/work/node_modules"),
            ("compose/package-deps.yml", "package-apply-update", str(repo_path("js/node_modules")), "/work/node_modules"),
            (
                "compose/package-deps.yml",
                "package-apply-update",
                str(repo_path("js/package-lock.json")),
                "/work/package-lock.json",
            ),
        }

        for compose_unit in compose_render_units():
            if "compose/deps.yml" not in compose_unit_files(compose_unit):
                continue
            expected.update({
                (compose_unit, "soldeer-apply-locked", str(repo_path("dapps/dependencies")), "/work/dependencies"),
                (compose_unit, "soldeer-apply-update", str(repo_path("dapps/dependencies")), "/work/dependencies"),
                (compose_unit, "soldeer-apply-update", str(repo_path("dapps/soldeer.lock")), "/work/soldeer.lock"),
                (compose_unit, "soldeer-apply-update", str(repo_path("dapps/remappings.txt")), "/work/remappings.txt"),
                (
                    compose_unit,
                    "soldeer-apply-update",
                    str(repo_path("dapps/dependency-checksums.txt")),
                    "/work/dependency-checksums.txt",
                ),
            })

        for dapp_dir in sorted(repo_path("dapps").iterdir()):
            if (dapp_dir / "cam" / "main.json").is_file():
                expected.add(
                    (
                        "compose/cam.yml",
                        "cam-integrity",
                        str(dapp_dir / "cam" / "main.json"),
                        f"/work/dapps/{dapp_dir.name}/cam/main.json",
                    )
                )
            if (dapp_dir / "src").is_dir() and (dapp_dir / "cam").is_dir():
                expected.add(
                    (
                        "compose/forge-abi.yml",
                        "forge-abi",
                        str(dapp_dir / "cam" / "abi"),
                        f"/work/dapps/{dapp_dir.name}/cam/abi",
                    )
                )

        actual = set()
        for compose_file in compose_render_units():
            config = rendered_compose_config(
                compose_file,
                env=compose_render_env(),
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

        mock_config = rendered_compose_config(
            "compose/viewer-terminal.yml",
            env=mock_viewer_env(),
        )
        self.assert_mock_viewer_terminal(compose_service(mock_config, "viewer-terminal"))
        self.assert_mock_viewer_terminal(compose_service(mock_config, "viewer-terminal-check"))

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
        self.assert_read_only_volumes(viewer, BIKE_NFT_BROADCAST_DIR)
        self.assert_bike_broadcast_volume_shared(viewer_config, deploy, viewer)

        command = compose_command_text(viewer)
        self.assertIn("npm run build:workspace", command)
        self.assertIn("node --experimental-strip-types tools/viewer-terminal/terminal-session.ts", command)

    def test_integration_fuzz_lanes_are_hardened_and_dapp_scoped(self) -> None:
        generic_config = rendered_compose_config(
            "compose/test/integration-fuzz.yml",
            env=integration_fuzz_env(),
        )
        generic = compose_service(generic_config, "test-integration-fuzz")

        self.assert_hardened(generic)
        self.assert_no_published_ports(generic)
        self.assert_staged_package_workspace(generic)
        self.assert_no_volume_target(generic, "/work/dapps")
        self.assert_read_only_volumes(generic, "/tmp/cam-integration.json")
        self.assertEqual(
            {"cam_integration": None},
            generic["networks"],
        )
        self.assertEqual("dapps-test-network", generic_config["networks"]["cam_integration"]["name"])
        self.assertTrue(generic_config["networks"]["cam_integration"]["external"])
        self.assertEqual("simulate", compose_mapping(generic, "environment")["CAM_INTEGRATION_WRITE_MODE"])
        command = compose_command_text(generic)
        self.assertIn("tsc -p tools/cam-integration-fuzz/tsconfig.json", command)
        self.assertIn("node --experimental-strip-types tools/cam-integration-fuzz/runner.ts", command)

        bike_config = rendered_compose_config(
            BIKE_NFT_TEST_INTEGRATION_FUZZ_COMPOSE,
            env=bike_integration_fuzz_env(),
        )
        deploy = compose_service(bike_config, "deploy-bike-nft-local")
        cam_http = compose_service(bike_config, "bike-nft-cam-http")
        bike = compose_service(bike_config, "test-integration-fuzz-bike-nft")
        bike_writes = compose_service(bike_config, "test-integration-fuzz-with-writes-bike-nft")

        self.assert_hardened(bike)
        self.assert_hardened(bike_writes)
        self.assert_no_published_ports(bike, bike_writes, deploy, cam_http)
        self.assert_internal_network(bike_config, "bike_nft_local", bike, bike_writes, deploy, cam_http)
        self.assertEqual("service_completed_successfully", bike["depends_on"]["deploy-bike-nft-local"]["condition"])
        self.assertEqual("service_healthy", bike["depends_on"]["bike-nft-cam-http"]["condition"])
        self.assertEqual("service_completed_successfully", bike_writes["depends_on"]["deploy-bike-nft-local"]["condition"])
        self.assertEqual("service_healthy", bike_writes["depends_on"]["bike-nft-cam-http"]["condition"])
        self.assert_staged_package_workspace(bike)
        self.assert_staged_package_workspace(bike_writes)
        self.assert_no_volume_target(bike, "/work/dapps")
        self.assert_no_volume_target(bike_writes, "/work/dapps")
        self.assert_read_only_volumes(bike, BIKE_NFT_BROADCAST_DIR)
        self.assert_read_only_volumes(bike_writes, BIKE_NFT_BROADCAST_DIR)
        self.assert_bike_broadcast_volume_shared(bike_config, deploy, bike)
        self.assert_bike_broadcast_volume_shared(bike_config, deploy, bike_writes)

        environment = compose_mapping(bike, "environment")
        self.assertEqual("eip155:31337", environment["CAM_INTEGRATION_CHAIN_ID"])
        self.assertEqual("http://bike-nft-anvil:8545", environment["CAM_INTEGRATION_RPC_URL"])
        self.assertEqual(BIKE_CAM_HTTP_ORIGIN, environment["CAM_INTEGRATION_RESOURCE_ORIGIN"])
        self.assertEqual("true", environment["CAM_INTEGRATION_ALLOW_UNSIGNED_CAM_HASH"])
        self.assertEqual("simulate", environment["CAM_INTEGRATION_WRITE_MODE"])
        self.assertNotIn("PRIVATE_KEY", environment)
        self.assertNotIn("CAM_INTEGRATION_PRIVATE_KEY", environment)
        writes_environment = compose_mapping(bike_writes, "environment")
        self.assertEqual("local-fixture", writes_environment["CAM_INTEGRATION_WRITE_MODE"])
        self.assertEqual(ANVIL_DEV_PRIVATE_KEY, writes_environment["CAM_INTEGRATION_PRIVATE_KEY"])
        self.assertNotIn("PRIVATE_KEY", writes_environment)
        bike_command = compose_command_text(bike)
        self.assertIn("node --input-type=module", bike_command)
        self.assertIn("tools/cam-integration-fuzz/runner.ts", bike_command)
        self.assertEqual(bike_command, compose_command_text(bike_writes))

    def test_bike_nft_local_gui_viewer_is_gatewayed_and_read_only(self) -> None:
        config = rendered_compose_config(
            BIKE_NFT_VIEWER_GUI_COMPOSE,
            env={
                "CAM_URI": f"{BIKE_NFT_GUI_ORIGIN}/cam/main.json",
                "CAM_HASH": ZERO_HASH,
                "BIKE_NFT_GUI_BIND_HOST": BIKE_NFT_GUI_BIND_HOST,
                "BIKE_NFT_GUI_ORIGIN": BIKE_NFT_GUI_ORIGIN,
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
        self.assert_published_port(gateway, host_ip=BIKE_NFT_GUI_BIND_HOST, target=8080, published="5173")

        self.assert_staged_package_workspace(cam_web)
        self.assert_no_volume_target(cam_web, "/work/dapps")
        self.assert_no_volume_target(cam_web, BIKE_NFT_BROADCAST_DIR)
        self.assertNotIn("PRIVATE_KEY", compose_mapping(cam_web, "environment"))
        self.assertNotIn("CAM_VIEWER_BROADCAST_PATH", compose_mapping(cam_web, "environment"))
        self.assert_read_only_volumes(viewer_url, BIKE_NFT_BROADCAST_DIR)
        self.assert_bike_broadcast_volume_shared(config, deploy, viewer_url)
        self.assertIn("run-js-workspace", compose_command_text(cam_web))
        self.assertIn("npm run build:workspace", compose_command_text(cam_web))
        self.assertIn("npm run dev -w cam-web", compose_command_text(cam_web))
        gateway_command = compose_command_text(gateway)
        self.assertIn("proxy_pass http://cam-web:5173", gateway_command)
        self.assertIn("proxy_pass http://bike-nft-anvil:8545", gateway_command)
        self.assertIn("proxy_pass http://bike-nft-cam-http:8080", gateway_command)
        self.assertEqual(f"{BIKE_NFT_GUI_ORIGIN}/", compose_mapping(viewer_url, "environment")["GUI_URL"])
        self.assertEqual(f"{BIKE_NFT_GUI_ORIGIN}/rpc", compose_mapping(viewer_url, "environment")["RPC_URL"])
