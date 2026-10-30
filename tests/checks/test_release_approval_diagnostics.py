from __future__ import annotations

import json
import os
from contextlib import contextmanager
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from .common import ROOT, import_python_module_with_env


class ApprovalBoundedDiagnosticsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rehearsal = import_python_module_with_env(
            "approval_bounded_diagnostics", ROOT / "tools/release_approval_pty_check.py", {},
        )

    def test_failed_preparation_retains_its_private_cause_before_teardown(self):
        with tempfile.TemporaryDirectory() as directory:
            case = Path(directory)
            (case / "reference").mkdir(mode=0o700)
            script = r'''
source tools/release_approval_deploy.sh
ceremony_root="$CASE_ROOT"
RELEASE_APPROVAL_REFERENCE_DIR="$CASE_ROOT/reference"
release_command_grace=15
release_approval_service_id() { printf fixture; }
release_run_owned() { printf '1\n'; }
docker() { [[ "$1" == logs ]]; printf '%s\n' 'Cannot admit CAM root: current binding differs from latest publication'; }
timeout() { shift 2; "$@"; }
if release_approval_wait_service release-reference-prepare 720; then exit 9; fi
'''
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], cwd=ROOT,
                                    env={**os.environ, "CASE_ROOT": str(case)}, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            diagnostic = case / "reference/preparation.log"
            self.assertIn("current binding differs", diagnostic.read_text())
            self.assertEqual(0, stat.S_IMODE(diagnostic.stat().st_mode) & 0o077)
            self.assertIn(str(diagnostic), result.stderr)
            self.assertNotIn("current binding differs", result.stderr)

    def test_live_private_logs_and_prompts_survive_chunk_boundaries_and_tail_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            try:
                wire = (
                    "Release container project: cam-release-" + "a" * 24 + "-run\r\n"
                    "\x1b[?25hRelease approval\r\n  App: escrow\r\n" + self.rehearsal.PROMPT + "\r\n"
                    "Review transaction 1\r\n  Press a to approve and send, r to reject and stop. No Enter for any key.\r\n"
                ).encode()
                for offset in range(0, len(wire), 3):
                    transcript.extend(wire[offset:offset + 3])
                self.assertEqual(wire, path.read_bytes())  # readable before shutdown
                self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))
                self.assertTrue(transcript.start_seen)
                self.assertIn("Release approval", transcript.identity_lines)
                self.assertEqual("cam-release-" + "a" * 24 + "-run", transcript.project)
                self.assertTrue(transcript.review_seen)
                self.assertTrue(transcript.review_ready)
                # A large line must not require an unbounded parser buffer or
                # force prompt searches over the accumulated terminal output.
                transcript.extend(b"x" * (transcript.TAIL_LIMIT + 4096))
                transcript.extend(b"\ncleanup-complete\n")
                self.assertLessEqual(len(transcript), transcript.TAIL_LIMIT)
                self.assertLessEqual(len(transcript.pending), transcript.LINE_LIMIT)
                self.assertNotIn(b"Review transaction", transcript)
                self.assertTrue(transcript.review_seen)
                self.assertTrue(transcript.review_ready)
                self.assertNotIn("fixture-challenge", transcript.status())
                self.assertEqual("cam-release-" + "a" * 24 + "-run", transcript.project)
                transcript.result = "passed"
            finally:
                transcript.finish()
            self.assertIn(b"cleanup-complete", path.with_name("approval-pty-tail.log").read_bytes())
            facts = json.loads(path.with_name("approval-diagnostics.json").read_text())
            self.assertTrue(facts["firstReviewSeen"])
            self.assertEqual("cam-release-" + "a" * 24 + "-run", facts["releaseProject"])
            self.assertEqual("passed", facts["result"])
            self.assertNotIn("fixture-challenge", json.dumps(facts))
            for file in Path(directory).iterdir():
                self.assertEqual(0o600, stat.S_IMODE(file.stat().st_mode))

    def test_invalid_or_conflicting_release_projects_fail_without_replacing_identity(self) -> None:
        owner = "cam-release-" + "a" * 24 + "-run"
        for announcement in ("foreign-project", "cam-release-" + "b" * 24 + "-run"):
            with self.subTest(announcement=announcement), tempfile.TemporaryDirectory() as directory:
                transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
                try:
                    transcript.extend(f"Release container project: {owner}\n".encode())
                    transcript.extend(f"Release container project: {announcement}\n".encode())
                    with self.assertRaisesRegex(RuntimeError, "project"):
                        transcript.check()
                    self.assertEqual(owner, transcript.project)
                finally:
                    transcript.finish()

    def test_sequential_approval_project_requires_the_previous_phase_artifact(self) -> None:
        first = "cam-release-" + "a" * 24 + "-run"
        second = "cam-release-" + "b" * 24 + "-run"
        keyless = "cam-release-" + "c" * 24 + "-run"
        for artifact_state in ("missing", "symlink", "complete"):
            with self.subTest(artifact_state=artifact_state), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                artifact = root / "contract-deployment.json"
                if artifact_state == "complete":
                    artifact.write_text("{}")
                elif artifact_state == "symlink":
                    (root / "unadmitted.json").write_text("{}")
                    artifact.symlink_to(root / "unadmitted.json")
                transcript = self.rehearsal.Transcript(root / "approval-pty.log")
                transcript.phase_artifacts = [artifact, root / "ui-deployment.json"]
                try:
                    transcript.extend(f"Release container project: {first}\nRelease approval\n  App: escrow\n".encode())
                    self.assertEqual(first, transcript.project)
                    transcript.extend(f"Release container project: {keyless}\n".encode())
                    self.assertEqual(first, transcript.project, "Keyless collection cannot replace the approval owner")
                    transcript.extend(f"Release container project: {second}\nRelease approval\n".encode())
                    if artifact_state == "complete":
                        transcript.check()
                        self.assertEqual(second, transcript.project)
                        self.assertEqual([first, second], transcript.projects)
                        self.assertNotIn("  App: escrow", transcript.identity_lines[transcript.identity_start:])
                    else:
                        with self.assertRaisesRegex(RuntimeError, "preceding phase artifact"):
                            transcript.check()
                        self.assertEqual(first, transcript.project)
                finally:
                    transcript.finish()

    def test_main_rejects_without_transmission_amid_foreign_releases_and_retains_forge_journals(self) -> None:
        for app in ("escrow", "bike-nft", "pay-to-play"):
            with self.subTest(app=app):
                self.assert_main_rejection(app, app)

    def test_wrong_app_or_suffix_in_display_stops_before_start(self) -> None:
        for app in ("escrow", "bike-nft", "pay-to-play"):
            for shown in ("another-app", app + "-other"):
                with self.subTest(app=app, shown=shown):
                    self.assert_main_rejection(app, shown)

    def assert_main_rejection(self, app: str, shown: str) -> None:
        owner = "cam-release-" + "a" * 24 + "-run"
        gate, foreign_gate, foreign_signer = "b" * 64, "c" * 64, "d" * 64
        signer = "9" * 64
        started = finished = False
        transcript = None
        deployer, source = "0x" + "1" * 40, "2" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "control").mkdir()
            (root / "control/release.json").write_text(json.dumps({
                "sourceCommit": source,
                "settings": {"OUTPUT_DIR": str(root / "deployment"), "EXPECTED_DEPLOYER_ADDRESS": deployer},
            }))
            env = {
                "RELEASE_APPROVAL_IMAGE": "sha256:" + "e" * 64,
                "RELEASE_REHEARSAL_DIR": directory,
                "RELEASE_REHEARSAL_NETWORK": "fixture-rehearsal",
                "RELEASE_APPROVAL_SIMULATION": "normal",
            }

            @contextmanager
            def terminal(path, selected_app, *, config_file):
                nonlocal transcript
                self.assertEqual(app, selected_app)
                self.assertEqual(root / "control/release.json", config_file)
                output = root / "deployment/contracts"
                (output / "broadcast").mkdir(parents=True)
                (output / "broadcast/run-latest.json").write_text('{"receipts":[],"transactions":[]}')
                (output / "artifact").mkdir()
                (output / "approval-audit").mkdir()
                (output / "approval-audit/approval.jsonl").write_text(
                    '{"kind":"pending"}\n{"kind":"closed","reason":"operator rejected"}\n'
                )
                transcript = self.rehearsal.Transcript(path)
                transcript.extend((
                    f"Release container project: {owner}\nRelease approval\n"
                    f"  App: {shown}\n  Chain ID: 31338\n  Signer: {deployer}\n"
                    f"  Source commit: {source}\n  Reference SHA-256: 0x{'f' * 64}\n"
                    + self.rehearsal.PROMPT + "\nReview transaction 1\n"
                    "  Press a to approve and send, r to reject and stop. No Enter for any key.\n"
                    + transcript.EXPLANATION + "\n"
                ).encode())
                try:
                    yield 0, None, transcript
                finally:
                    transcript.finish()

            def docker(*args):
                if args[0] == "ps":
                    self.assertIn(f"label=com.docker.compose.project={owner}", args)
                    if finished:
                        return ""
                    signers = {foreign_signer}
                    if started:
                        signers.add(signer)
                    all_projects = {"release-approval": {gate, foreign_gate}, "deploy-release": signers}
                    for service, inventory in all_projects.items():
                        if f"label=com.docker.compose.service={service}" in args:
                            return "\n".join(inventory & {gate, signer})
                    self.fail("Unexpected release service query")
                self.assertEqual(("inspect", "--format", "{{.State.Status}}"), args[:3])
                self.assertIn(args[3], (gate, signer))
                return "running"

            def write(_descriptor, wire):
                nonlocal started
                if wire == b"\n":
                    self.assertFalse(started)
                elif wire == b"start\n":
                    self.assertEqual(2, transcript.identity_lines.count(self.rehearsal.PROMPT))
                    started = True
                else:
                    self.assertEqual(b"r", wire)
                return len(wire)

            def read(_master, _process, observed, predicate, _deadline, explanation):
                if "blank Enter" in explanation:
                    self.assertFalse(started)
                    self.assertFalse(predicate(), "The driver must wait for the terminal to repeat its prompt")
                    observed.extend((self.rehearsal.PROMPT + "\n").encode())
                    self.assertTrue(predicate())

            def exited(*_args):
                nonlocal finished
                finished = True
                return 1

            with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
                self.rehearsal, "release_terminal", side_effect=terminal,
            ), mock.patch.object(self.rehearsal, "fixture_nonce", return_value=0), mock.patch.object(
                self.rehearsal, "read_until", side_effect=read,
            ), mock.patch.object(self.rehearsal, "docker", side_effect=docker), mock.patch.object(
                self.rehearsal, "approval_socket_source", return_value=root / "absent.sock",
            ), mock.patch.object(
                self.rehearsal, "backend_chain_id",
            ) as backend, mock.patch.object(self.rehearsal, "listener_chain_id"), mock.patch.object(
                self.rehearsal, "approval_chain_id",
            ), mock.patch.object(self.rehearsal, "signer_rpc_read"), mock.patch.object(
                self.rehearsal, "wait_for_exit", side_effect=exited,
            ), mock.patch.object(self.rehearsal.os, "write", side_effect=write) as commands:
                if app != shown:
                    with self.assertRaisesRegex(RuntimeError, "release identity"):
                        self.rehearsal.main(app, "reject")
                    commands.assert_not_called()
                    backend.assert_not_called()
                    return
                self.rehearsal.main(app, "reject")
                backend.assert_called_once_with(gate)
                self.assertEqual([b"\n", b"start\n", b"r"],
                                 [call.args[1] for call in commands.call_args_list])
            facts = json.loads((root / "approval-diagnostics.json").read_text())
            self.assertEqual("passed", facts["result"])
            self.assertTrue((root / "deployment/contracts/broadcast/run-latest.json").is_file())

    def test_transcript_limit_fails_the_check_but_retains_cleanup_tail(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            self.rehearsal.Transcript, "FILE_LIMIT", 2048,
        ), mock.patch.object(self.rehearsal.Transcript, "TAIL_LIMIT", 1024):
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            transcript.extend(b"a" * 4096)
            with self.assertRaisesRegex(RuntimeError, "byte limit"):
                transcript.check()
            # Cleanup must still be able to drain output after this error.
            transcript.extend(b"\ncleanup-finished\n")
            transcript.finish()
            transcript.finish()  # idempotent finalization
            self.assertLessEqual(path.stat().st_size, 2048)
            self.assertLessEqual(len(transcript), 1024)
            self.assertIn(b"cleanup-finished", path.with_name("approval-pty-tail.log").read_bytes())
            facts = json.loads(path.with_name("approval-diagnostics.json").read_text())
            self.assertTrue(facts["transcriptTruncated"])
            self.assertEqual(4096 + len(b"\ncleanup-finished\n"), facts["transcriptBytesSeen"])

    def test_rpc_extract_is_live_and_summary_contains_only_safe_counters(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            try:
                line = b"approval RPC connection=2 request=1 method=eth_chainId request params=0\n"
                transcript.extend(line)
                transcript.extend(b"approval RPC connection=2 request=1 method=eth_chainId response outcome=result write=flushed elapsed_ms=2\n")
                transcript.extend(b"approval RPC stats attempts=30 active=2 peak=8 rejected=5 empty=20 parse_errors=1 suppressed=7 stopped=0\n")
                self.assertTrue(path.with_name("approval-rpc.log").read_bytes().startswith(line))
                self.assertEqual(1, transcript.requests)
                self.assertEqual(1, transcript.responses)
                self.assertEqual(8, transcript.stats["peak"])
                self.assertIn("rejected=5", transcript.status())
                transcript.extend(b"approval RPC connection=4 request=1 method=credentialLikeMethod request params=0\n")
                self.assertNotIn("credentialLikeMethod", transcript.status())
                transcript.extend(b"approval RPC fatal reason=IPC connection storm: more than 256 attempts in 1000ms\n")
                with self.assertRaisesRegex(RuntimeError, "connection storm"):
                    transcript.check()
            finally:
                transcript.finish()
            facts = path.with_name("approval-diagnostics.json").read_text()
            self.assertNotIn("credentialLikeMethod", facts)
            self.assertIn("connection storm", facts)

    def test_rpc_log_has_an_independent_byte_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            self.rehearsal.Transcript, "RPC_LIMIT", 128,
        ):
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            try:
                for _ in range(10):
                    transcript.extend(b"approval RPC connection=2 request=1 method=eth_chainId request params=0\n")
                with self.assertRaisesRegex(RuntimeError, "RPC diagnostic output"):
                    transcript.check()
            finally:
                transcript.finish()
            self.assertLessEqual(path.with_name("approval-rpc.log").stat().st_size, 128)

    def test_log_write_failure_does_not_prevent_drain_or_expose_error_text(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            original = transcript.output
            transcript.output = mock.Mock(wraps=original)
            transcript.output.write.side_effect = OSError("sensitive-path-error")
            transcript.extend(b"first\n")
            transcript.extend(b"cleanup-output\n")
            self.assertIn(b"cleanup-output", transcript)
            self.assertIsInstance(transcript.failure, str)
            self.assertNotIn("sensitive-path-error", transcript.failure)
            with self.assertRaisesRegex(OSError, "could not be saved"):
                transcript.finish()
            self.assertTrue(original.closed)
            self.assertIn(b"cleanup-output", path.with_name("approval-pty-tail.log").read_bytes())

    def test_log_limits_preserve_the_first_recorded_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            self.rehearsal.Transcript, "FILE_LIMIT", 256,
        ), mock.patch.object(self.rehearsal.Transcript, "RPC_LIMIT", 16):
            transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
            try:
                transcript.failure = "first failure"
                transcript.extend(b"x" * 1024 + b"\n")
                transcript.extend(b"approval RPC connection=1 request=1 method=eth_chainId request params=0\n")
                self.assertEqual("first failure", transcript.failure)
                with self.assertRaisesRegex(RuntimeError, "first failure"):
                    transcript.check()
            finally:
                transcript.finish()

    def test_summary_does_not_invent_a_simulation_mode(self) -> None:
        for mode in (None, "normal", "skip"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                env = {}
                if mode is not None:
                    env["RELEASE_APPROVAL_SIMULATION"] = mode
                path = Path(directory) / "approval-pty.log"
                with mock.patch.dict(os.environ, env, clear=True):
                    transcript = self.rehearsal.Transcript(path)
                    transcript.finish()
                facts = json.loads(path.with_name("approval-diagnostics.json").read_text())
                self.assertEqual(mode, facts["simulation"])

    def test_pty_rejects_missing_empty_or_unknown_mode_before_docker(self) -> None:
        for mode in (None, "", "auto"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                env = {
                    "RELEASE_APPROVAL_IMAGE": "sha256:" + "a" * 64,
                    "RELEASE_REHEARSAL_DIR": directory,
                    "RELEASE_REHEARSAL_NETWORK": "fixture-rehearsal",
                }
                if mode is not None:
                    env["RELEASE_APPROVAL_SIMULATION"] = mode
                with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
                    self.rehearsal, "docker",
                ) as docker, mock.patch.object(self.rehearsal, "fixture_nonce") as nonce:
                    with self.assertRaisesRegex(RuntimeError, "RELEASE_APPROVAL_SIMULATION"):
                        self.rehearsal.main("escrow", "reject")
                docker.assert_not_called()
                nonce.assert_not_called()
                self.assertEqual([], list(Path(directory).iterdir()))

    def test_refuses_existing_or_symlinked_output_without_clobbering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "retained"
            target.write_bytes(b"must not change")
            log = root / "approval-pty.log"
            log.symlink_to(target)
            with self.assertRaises(OSError):
                self.rehearsal.Transcript(log)
            self.assertEqual(b"must not change", target.read_bytes())

    def test_wait_progress_is_visible_and_prompt_state_is_incremental(self) -> None:
        clock = [0.0]
        with tempfile.TemporaryDirectory() as directory:
            transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
            def drain(*_args):
                clock[0] += 5
                transcript.extend(b"unrelated output\n")
                return False
            try:
                with mock.patch.object(self.rehearsal.time, "monotonic", side_effect=lambda: clock[0]), mock.patch.object(
                    self.rehearsal, "process_status", return_value=None,
                ), mock.patch.object(self.rehearsal, "drain_terminal", side_effect=drain), mock.patch.object(
                    self.rehearsal, "progress",
                ) as report:
                    self.rehearsal.read_until(99, mock.Mock(), transcript, lambda: clock[0] >= 10, 30, "fixture prompt")
                messages = [call.args[0] for call in report.call_args_list]
                self.assertTrue(messages[0].startswith("Waiting for fixture prompt"))
                self.assertTrue(any("Still waiting" in message for message in messages))
                self.assertEqual("Reached fixture prompt", messages[-1])
            finally:
                transcript.finish()

    def test_fast_exit_still_reads_a_buffered_storm_diagnosis(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
            def drain(*_args):
                transcript.extend(b"approval RPC fatal reason=IPC connection storm: more than 256 attempts in 1000ms\n")
                return True
            try:
                with mock.patch.object(self.rehearsal, "process_status", return_value=2), mock.patch.object(
                    self.rehearsal, "drain_terminal", side_effect=drain,
                ), mock.patch.object(self.rehearsal, "progress"):
                    with self.assertRaisesRegex(RuntimeError, "connection storm"):
                        self.rehearsal.read_until(
                            99, mock.Mock(), transcript, lambda: False,
                            self.rehearsal.time.monotonic() + 10, "first review",
                        )
            finally:
                transcript.finish()

    def test_inner_cleanup_failure_is_not_reported_as_a_successful_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "approval-pty.log"
            def stop(_process, _master, transcript):
                transcript.extend(b"Release cleanup is incomplete; retained path for inspection: /tmp/fixture\n")
            with mock.patch.object(self.rehearsal.subprocess, "Popen", return_value=mock.Mock()), mock.patch.object(
                self.rehearsal, "stop_release", side_effect=stop,
            ), mock.patch.object(self.rehearsal, "progress"):
                with self.assertRaisesRegex(self.rehearsal.ReleaseCleanupError, "Inner release cleanup"):
                    with self.rehearsal.release_terminal(path, "escrow", config_file=None) as (_master, _process, transcript):
                        transcript.result = "passed"
            facts = json.loads(path.with_name("approval-diagnostics.json").read_text())
            self.assertEqual("cleanup-incomplete", facts["result"])
            self.assertIs(facts["cleanupIncomplete"], True)


class ApprovalSimulationDiagnosticTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.preparer = import_python_module_with_env(
            "approval_simulation_diagnostic",
            ROOT / "tests/fixtures/release-rehearsal/prepare_simulation.py", {},
        )

    def fixture(self, root: Path) -> tuple[Path, Path, str]:
        source = root / "source"
        candidate = source / "compose/release/deploy.yml"
        candidate.parent.mkdir(parents=True)
        text = "          --rpc-url file:///run/approval/rpc.sock " + "\\" + "\n" + self.preparer.NORMAL
        candidate.write_text(text)
        return source, candidate, text

    def test_only_the_private_candidate_command_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, candidate, original = self.fixture(root)
            untouched = root / "operator-checkout.yml"
            untouched.write_text(original)
            self.preparer.enable_skip(root, source)
            self.assertEqual(original.replace(self.preparer.NORMAL, self.preparer.SKIP), candidate.read_text())
            self.assertEqual(original, untouched.read_text())
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                self.preparer.enable_skip(root, source)

    def test_refuses_existing_git_checkout_and_ambiguous_command(self) -> None:
        for kind in ("git", "missing", "duplicate", "no-gate"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source, candidate, original = self.fixture(root)
                if kind == "git":
                    (source / ".git").mkdir()
                elif kind == "missing":
                    candidate.write_text(original.replace(self.preparer.NORMAL, ""))
                elif kind == "duplicate":
                    candidate.write_text(original + self.preparer.NORMAL)
                else:
                    candidate.write_text(original.replace("file:///run/approval/rpc.sock", "http://must-not-use"))
                before = candidate.read_text()
                with self.assertRaises(ValueError):
                    self.preparer.enable_skip(root, source)
                self.assertEqual(before, candidate.read_text())

    def test_refuses_symlinks_and_non_private_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, candidate, original = self.fixture(root)
            target = root / "outside.yml"
            target.write_text(original)
            candidate.unlink()
            candidate.symlink_to(target)
            with self.assertRaises(ValueError):
                self.preparer.enable_skip(root, source)
            self.assertEqual(original, target.read_text())
            candidate.unlink()
            candidate.write_text(original)
            root.chmod(0o755)
            with self.assertRaisesRegex(ValueError, "owner-only"):
                self.preparer.enable_skip(root, source)
            root.chmod(0o700)

    def test_cli_requires_explicit_fixture_mode_and_escrow(self) -> None:
        for env in ({}, {"RELEASE_REHEARSAL": "0"}, {
            "RELEASE_REHEARSAL": "1", "DAPP": "pay-to-play", "RELEASE_APPROVAL_SIMULATION": "skip",
        }, {"RELEASE_REHEARSAL": "1", "DAPP": "escrow", "RELEASE_APPROVAL_SIMULATION": "normal"}):
            with self.subTest(env=env), mock.patch.dict(os.environ, env, clear=True):
                with self.assertRaises(SystemExit):
                    self.preparer.main()


if __name__ == "__main__":
    unittest.main()
