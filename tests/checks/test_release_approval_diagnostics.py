from __future__ import annotations

import json
import os
from pathlib import Path
import stat
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

    def test_live_private_logs_and_prompts_survive_chunk_boundaries_and_tail_eviction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "approval-pty.log"
            transcript = self.rehearsal.Transcript(path)
            try:
                wire = (
                    "Release approval\r\n  App: escrow\r\n" + self.rehearsal.PROMPT + "\r\n"
                    "Review transaction 1\r\n  Reject with: reject fixture-challenge\r\n"
                ).encode()
                for offset in range(0, len(wire), 3):
                    transcript.extend(wire[offset:offset + 3])
                self.assertEqual(wire, path.read_bytes())  # readable before shutdown
                self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))
                self.assertTrue(transcript.start_seen)
                self.assertTrue(transcript.review_seen)
                self.assertEqual("fixture-challenge", transcript.challenge)
                # A large line must not require an unbounded parser buffer or
                # force prompt searches over the accumulated terminal output.
                transcript.extend(b"x" * (transcript.TAIL_LIMIT + 4096))
                transcript.extend(b"\ncleanup-complete\n")
                self.assertLessEqual(len(transcript), transcript.TAIL_LIMIT)
                self.assertLessEqual(len(transcript.pending), transcript.LINE_LIMIT)
                self.assertNotIn(b"Review transaction", transcript)
                self.assertTrue(transcript.review_seen)
                self.assertEqual("fixture-challenge", transcript.challenge)
                self.assertNotIn("fixture-challenge", transcript.status())
                transcript.result = "passed"
            finally:
                transcript.finish()
            self.assertIn(b"cleanup-complete", path.with_name("approval-pty-tail.log").read_bytes())
            facts = json.loads(path.with_name("approval-diagnostics.json").read_text())
            self.assertTrue(facts["firstReviewSeen"])
            self.assertEqual("passed", facts["result"])
            self.assertNotIn("fixture-challenge", json.dumps(facts))
            for file in Path(directory).iterdir():
                self.assertEqual(0o600, stat.S_IMODE(file.stat().st_mode))

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
            self.assertNotIn("sensitive-path-error", transcript.failure or "")
            with self.assertRaisesRegex(OSError, "could not be saved"):
                transcript.finish()
            self.assertTrue(original.closed)
            self.assertIn(b"cleanup-output", path.with_name("approval-pty-tail.log").read_bytes())

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
                    with self.rehearsal.release_terminal(path) as (_master, _process, transcript):
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
