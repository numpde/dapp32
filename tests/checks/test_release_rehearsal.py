from __future__ import annotations

import os
import signal
import unittest

from .common import compose_mapping, compose_sequence_or_empty, compose_service, rendered_compose_config
from .test_release_approval_image import _ReleaseCommandHarness
from .text.test_rendered_compose_posture import makefile_compose_units, release_rehearsal_units


class ReleaseRehearsalTest(unittest.TestCase):
    def test_rehearsal_preserves_release_commands_and_rpc_method_gates(self) -> None:
        for files in release_rehearsal_units():
            with self.subTest(files=files):
                normal = rendered_compose_config(files[:-1])["services"]
                fixture = rendered_compose_config(files)["services"]
                for name, service in normal.items():
                    if "command" in service:
                        self.assertEqual(service["command"], fixture[name]["command"])
                    if "environment" in service and "RPC_ALLOWED_METHODS" in service["environment"]:
                        self.assertEqual(service["environment"]["RPC_ALLOWED_METHODS"], fixture[name]["environment"]["RPC_ALLOWED_METHODS"])
                    if name in ("release-plan", "verify-input"):
                        self.assertEqual("0", service["environment"]["RELEASE_REHEARSAL"])
                        self.assertEqual("1", fixture[name]["environment"]["RELEASE_REHEARSAL"])

    def test_owner_only_rpc_files_use_the_creating_users_identity(self) -> None:
        infrastructure = rendered_compose_config("compose/release/rehearsal.yml")["services"]
        file_owner = infrastructure["rehearsal-prepare"]["user"]
        for name, files in makefile_compose_units().items():
            if name.endswith(("_RELEASE_DEPLOY_COMPOSE_FILES", "_RELEASE_VERIFY_COMPOSE_FILES")):
                services = rendered_compose_config(files)["services"]
                for service_name in ("release-rpc-proxy", "release-artifact-rpc-proxy", "verify-rpc-proxy"):
                    if service_name in services:
                        self.assertEqual(file_owner, services[service_name]["user"])

    def test_fixture_has_no_public_network_or_source_write_authority(self) -> None:
        infrastructure = rendered_compose_config("compose/release/rehearsal.yml")
        for network in infrastructure["networks"].values():
            self.assertIs(network["internal"], True)
        for service in infrastructure["services"].values():
            self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            self.assertIs(service["read_only"], True)
        prepare = compose_service(infrastructure, "rehearsal-prepare")
        writable = [
            volume["target"] for volume in prepare["volumes"]
            if volume.get("type") == "bind" and volume.get("read_only") is not True
        ]
        self.assertEqual(["/rehearsal-control"], writable)
        accept = compose_service(infrastructure, "rehearsal-accept")
        for volume in accept["volumes"]:
            self.assertIs(volume["read_only"], True)

    def test_fixture_network_replaces_only_the_public_upstream_network(self) -> None:
        for files in release_rehearsal_units():
            config = rendered_compose_config(files)
            for name, service in config["services"].items():
                if name.endswith("rpc-proxy"):
                    self.assertEqual(["python3", "/rehearsal/rpc_proxy.py"], service["entrypoint"])
                self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            for name, network in compose_mapping(config, "networks").items():
                if name.endswith("_egress"):
                    self.assertIs(network["external"], True)
                    self.assertEqual("cam-release-rehearsal-fixture", network["name"])
                else:
                    self.assertIs(network["internal"], True)


class ReleaseRehearsalCancellationTest(unittest.TestCase):
    def test_target_deadline_waits_for_child_cleanup_before_fixture_teardown(self) -> None:
        for phase, down_status in (("infrastructure", 0), ("pty", 0), ("pty", 1)):
            with self.subTest(phase=phase, down_status=down_status):
                with _ReleaseCommandHarness(
                    "rehearsal-target", block=phase, hold_down=False,
                    down_status=down_status, child_status=0,
                ) as run:
                    run.wait_for("child-ready ")
                    lines = run.wait_for("child-term")
                    if phase == "pty":
                        self.assertFalse(any(line.startswith("down-start ") for line in lines))
                        run.release()
                    self.assertNotEqual(0, run.finish())
                    lines = run.lines()
                    self.assertLess(lines.index("child-stopped"), next(
                        index for index, line in enumerate(lines) if line.startswith("down-start ")
                    ))
                    run.assert_owned_cleanup(self)
                    if phase == "pty":
                        self.assertEqual(bool(down_status), (run.work / "source/js/node_modules").exists())
                        self.assertEqual(bool(down_status), (run.work / "source/dapps/dependencies").exists())

    def test_parent_signals_wait_for_pty_cleanup_before_fixture_teardown(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=signum):
                with _ReleaseCommandHarness(
                    "rehearsal", block="pty", hold_down=True, down_status=0, child_status=0,
                ) as run:
                    run.wait_for("child-ready ")
                    os.kill(run.process.pid, signum)
                    lines = run.wait_for("child-term")
                    self.assertFalse(any(line.startswith("down-start ") for line in lines))
                    self.assertTrue((run.work / "source/js/node_modules/owned").is_file())
                    self.assertTrue((run.work / "source/dapps/dependencies/owned").is_file())
                    # The nested PTY driver, not the outer shell, decides when its
                    # signer cleanup has finished.
                    run.release()
                    lines = run.wait_for("down-start ")
                    self.assertLess(lines.index("child-stopped"), next(
                        index for index, line in enumerate(lines) if line.startswith("down-start ")
                    ))
                    os.killpg(run.process.pid, signal.SIGINT)
                    os.killpg(run.process.pid, signal.SIGTERM)
                    self.assertIsNone(run.process.poll())
                    run.release()
                    self.assertEqual(128 + signum, run.finish())
                    run.assert_owned_cleanup(self)
                    self.assertFalse((run.work / "source/js/node_modules").exists())
                    self.assertFalse((run.work / "source/dapps/dependencies").exists())
                    self.assertTrue((run.work / "cleanup.log").is_file())
                    self.assertTrue((run.work / "source-commit").is_file())
                    self.assertIn("Release rehearsal records:", run.log.read_text(encoding="utf-8"))

    def test_failed_child_or_fixture_teardown_retains_mounted_dependencies(self) -> None:
        for child_status, down_status in ((2, 0), (0, 1)):
            with self.subTest(child_status=child_status, down_status=down_status):
                with _ReleaseCommandHarness(
                    "rehearsal", block="pty", hold_down=False,
                    child_status=child_status, down_status=down_status,
                ) as run:
                    run.wait_for("child-ready ")
                    os.kill(run.process.pid, signal.SIGTERM)
                    run.wait_for("child-term")
                    run.release()
                    self.assertNotEqual(0, run.finish())
                    run.assert_owned_cleanup(self)
                    self.assertTrue((run.work / "source/js/node_modules/owned").is_file())
                    self.assertTrue((run.work / "source/dapps/dependencies/owned").is_file())
                    self.assertIn("Mounted rehearsal inputs retained", run.log.read_text(encoding="utf-8"))
