from __future__ import annotations

import os
import re
import shlex
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_mapping, compose_sequence_or_empty, compose_service, rendered_compose_config
from .test_release_approval_image import _ReleaseCommandHarness
from .release_posture import expanded_release_target
from .text.test_rendered_compose_posture import makefile_compose_units, release_rehearsal_units


class ReleaseRehearsalTest(unittest.TestCase):
    def test_executed_planner_composition_is_complete_for_each_app(self):
        source = (ROOT / "tools/release_rehearsal.sh").read_text()
        declaration = re.search(r"(?m)^planner_compose=\(.*\)$", source).group()
        source_assignment = re.search(r"(?m)^export RELEASE_SOURCE_DIR=.*$", source).group()
        output_assignment = re.search(r"(?m)^export RELEASE_OUTPUT_DIR=.*$", source).group()
        candidate_assignment = re.search(r"(?m)^export CONTRACT_RELEASE_CANDIDATE_DIR=.*$", source).group()
        for app in ("bike-nft", "escrow", "pay-to-play"):
            with self.subTest(app=app):
                recipe = shlex.split(expanded_release_target(app + "/release/rehearsal/run"))
                invocation = recipe[recipe.index("tools/release_rehearsal.sh") + 1:]
                arguments = subprocess.check_output(
                    ["bash", "-c", "\n".join((source_assignment, output_assignment, candidate_assignment, declaration)) + '; printf "%s\\0" "$RELEASE_SOURCE_DIR" "$CONTRACT_RELEASE_CANDIDATE_DIR" "${planner_compose[@]}"', "rehearsal", *invocation],
                    env={**os.environ, "project": "fixture", "app": app, "RELEASE_REHEARSAL_DIR": "/tmp/rehearsal-fixture"}, text=True,
                ).split("\0")[:-1]
                supplied = {"RELEASE_SOURCE_DIR": arguments.pop(0), "CONTRACT_RELEASE_CANDIDATE_DIR": arguments.pop(0)}
                files = tuple(arguments[index + 1] for index, value in enumerate(arguments) if value == "-f")
                self.assertEqual(makefile_compose_units()["CONTRACT_RELEASE_DEPLOY_COMPOSE_FILES"], files[:-1])
                self.assertEqual("/tmp/rehearsal-fixture/source", supplied["RELEASE_SOURCE_DIR"])
                self.assertEqual("/tmp/rehearsal-fixture/planner-check/candidate", supplied["CONTRACT_RELEASE_CANDIDATE_DIR"])
                services = rendered_compose_config(files, env=supplied)["services"]
                for name in ("release-plan", "release-rpc-proxy", "release-artifact-rpc-proxy", "release-artifact"):
                    self.assertTrue(services[name].get("image") or services[name].get("build"), name)

    def test_rehearsal_preserves_release_commands_and_rpc_method_gates(self) -> None:
        for files in release_rehearsal_units():
            with self.subTest(files=files):
                normal = rendered_compose_config(files[:-1], env={"CAM_RELEASE_HASH": "0x" + "c" * 64})["services"]
                fixture = rendered_compose_config(files, env={"CAM_RELEASE_HASH": "0x" + "c" * 64})["services"]
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
                services = rendered_compose_config(files, env={"CAM_RELEASE_HASH": "0x" + "c" * 64})["services"]
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
            config = rendered_compose_config(files, env={"CAM_RELEASE_HASH": "0x" + "c" * 64})
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
    def test_ordinary_rehearsal_builds_candidate_image_and_uses_shared_pty_success(self) -> None:
        with _ReleaseCommandHarness(
            "rehearsal-full", block="pty", hold_down=False, down_status=0, child_status=0,
        ) as run:
            lines = run.wait_for("child-ready ")
            build = next(line for line in lines if line.startswith("fixture-image-build "))
            self.assertIn(" " + "a" * 40 + " ", build)
            self.assertIn(str(run.work / "approval-image"), build)
            command = next(line for line in lines if line.startswith("pty "))
            self.assertIn("escrow success", command)
            self.assertIn("image=sha256:" + "b" * 64, command)
            self.assertLess(lines.index(build), lines.index(command))
            os.kill(run.process.pid, signal.SIGTERM)
            run.wait_for("child-term")
            run.release()
            self.assertEqual(143, run.finish())
            run.assert_owned_cleanup(self)

    def test_failed_fixture_build_or_provenance_stops_before_approval(self) -> None:
        for fault in ("builder-fail", "builder-json"):
            with self.subTest(fault=fault), _ReleaseCommandHarness(
                "rehearsal-full", block=fault, hold_down=False, down_status=0, child_status=0,
            ) as run:
                self.assertNotEqual(0, run.finish())
                self.assertFalse(any(line.startswith("pty ") for line in run.lines()))
                run.assert_owned_cleanup(self)

    def test_fixture_builder_stops_before_outer_infrastructure_teardown(self) -> None:
        with _ReleaseCommandHarness(
            "rehearsal-full", block="builder", hold_down=False, down_status=0, child_status=0,
        ) as run:
            run.wait_for("child-ready ")
            os.kill(run.process.pid, signal.SIGTERM)
            run.wait_for("child-term")
            self.assertEqual(143, run.finish())
            run.assert_owned_cleanup(self)
            lines = run.lines()
            self.assertLess(lines.index("child-stopped"), lines.index("down-start " + run.project))
            self.assertFalse(any(line.startswith("pty ") for line in lines))

    def test_approval_records_stay_under_the_build_folder_after_cancellation(self) -> None:
        with _ReleaseCommandHarness(
            "rehearsal", block="pty", hold_down=False, down_status=0, child_status=0,
        ) as run:
            original_provenance = run.provenance.read_bytes()
            run.wait_for("child-ready ")
            self.assertEqual(run.build / "rehearsals", run.work.parent)
            self.assertEqual(0o700, stat.S_IMODE(run.work.stat().st_mode))
            console = run.log.read_text(encoding="utf-8")
            self.assertIn(f"Logs and diagnostics: {run.work} (retained after cleanup)", console)
            self.assertLess(console.index("Logs and diagnostics:"), console.index("Snapshotting candidate source"))
            os.kill(run.process.pid, signal.SIGTERM)
            run.wait_for("child-term")
            run.release()
            self.assertNotEqual(0, run.finish())
            self.assertTrue((run.work / "approval-diagnostics.json").is_file())
            self.assertIn(f"Release rehearsal records: {run.work}", run.log.read_text(encoding="utf-8"))
            self.assertEqual(original_provenance, run.provenance.read_bytes())
            run.assert_owned_cleanup(self)

    def test_approval_never_reuses_an_existing_run_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            build = Path(temporary) / "build"
            existing = build / "rehearsals" / "20261021T000000000000Z-aaaaaaaa"
            existing.mkdir(parents=True)
            diagnostic = existing / "approval-diagnostics.json"
            diagnostic.write_text("previous run\n", encoding="utf-8")
            with _ReleaseCommandHarness(
                "rehearsal", block="pty", hold_down=False,
                down_status=0, child_status=0, build_directory=build,
            ) as run:
                self.assertNotEqual(0, run.finish())
                self.assertFalse(any(line.startswith("compose ") for line in run.lines()))
                self.assertEqual("previous run\n", diagnostic.read_text(encoding="utf-8"))

    def test_approval_rejects_unsafe_build_folders_before_starting_docker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            valid = root / "valid"
            valid.mkdir()
            ancestor = root / "linked"
            ancestor.symlink_to(valid, target_is_directory=True)
            (valid / "child").mkdir()
            regular = root / "file"
            regular.write_text("not a directory\n", encoding="utf-8")
            for path in (Path("relative"), root / "missing", regular, ancestor, ancestor / "child", valid / ".." / "valid"):
                with self.subTest(path=path):
                    with _ReleaseCommandHarness(
                        "rehearsal", block="pty", hold_down=False,
                        down_status=0, child_status=0, build_directory=path,
                    ) as run:
                        self.assertNotEqual(0, run.finish())
                        self.assertFalse(any(line.startswith("compose ") for line in run.lines()))
                        self.assertIn("existing normalized absolute directory", run.log.read_text(encoding="utf-8"))

    def test_approval_refuses_a_redirected_rehearsal_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            build = root / "build"
            build.mkdir()
            unrelated = root / "unrelated"
            unrelated.mkdir()
            (build / "rehearsals").symlink_to(unrelated, target_is_directory=True)
            with _ReleaseCommandHarness(
                "rehearsal", block="pty", hold_down=False,
                down_status=0, child_status=0, build_directory=build,
            ) as run:
                self.assertNotEqual(0, run.finish())
                self.assertFalse(any(line.startswith("compose ") for line in run.lines()))
                self.assertIn("rehearsals must be a directory without a symlink", run.log.read_text(encoding="utf-8"))
                self.assertEqual([], list(unrelated.iterdir()))

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
