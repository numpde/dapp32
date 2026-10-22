from __future__ import annotations

import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock

from .common import ROOT, import_python_module_with_env


PREFLIGHT = ROOT / "tools/release_approval_preflight.sh"
TEST_IMAGE_ID = "sha256:" + "a" * 64


class ApprovalLauncherTest(unittest.TestCase):
    def run_preflight(self, image: str, *, inspector_result: str) -> subprocess.CompletedProcess[str]:
        env = {
            **os.environ,
            "RELEASE_APPROVAL_IMAGE": image,
            "DOCKER_EXPECTED_IMAGE": image,
            "DOCKER_INSPECT_RESULT": inspector_result,
        }
        shell = (
            f'. "{PREFLIGHT}"; '
            "docker() { "
            "[ \"$1 $2 $3\" = 'image inspect --format' ] || return 91; "
            "[ \"$5\" = \"$DOCKER_EXPECTED_IMAGE\" ] || return 92; "
            "printf '%s\\n' \"$DOCKER_INSPECT_RESULT\"; "
            "}; release_approval_require_image"
        )
        return subprocess.run(["sh", "-eu", "-c", shell], env=env, capture_output=True, text=True, check=False)

    def test_approval_image_must_be_a_locally_present_exact_id(self) -> None:
        self.assertEqual(0, self.run_preflight(TEST_IMAGE_ID, inspector_result=TEST_IMAGE_ID).returncode)
        for wrong in ("", "latest", "example/release-approval:latest", "sha256:" + "b" * 64):
            with self.subTest(wrong=wrong):
                result = self.run_preflight(wrong, inspector_result=TEST_IMAGE_ID)
                self.assertNotEqual(0, result.returncode)
        mismatch = self.run_preflight(TEST_IMAGE_ID, inspector_result="sha256:" + "b" * 64)
        self.assertNotEqual(0, mismatch.returncode)
        self.assertIn("image", mismatch.stderr.lower())

    def test_approval_requires_a_real_operator_terminal(self) -> None:
        result = subprocess.run(
            ["sh", "-eu", "-c", f'. "{PREFLIGHT}"; release_approval_require_terminal'],
            capture_output=True, text=True, check=False,
        )
        self.assertNotEqual(0, result.returncode)
        self.assertIn("terminal", result.stderr.lower())

    def test_invalid_expected_deployer_fails_before_output_creation(self) -> None:
        with tempfile.TemporaryDirectory() as parent:
            output = Path(parent) / "new-release"
            for address in ("", "0x" + "0" * 40, "0x" + "1" * 39, "0x" + "g" * 40):
                with self.subTest(address=address):
                    result = subprocess.run(
                        ["sh", "-eu", "-c", f'. "{PREFLIGHT}"; '
                         'release_approval_require_deployer EXPECTED_DEPLOYER "$DEPLOYER"; '
                         'mkdir "$OUTPUT"'],
                        env={**os.environ, "DEPLOYER": address, "OUTPUT": str(output)},
                        capture_output=True, text=True, check=False,
                    )
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(output.exists())
            valid = subprocess.run(
                ["sh", "-eu", "-c", f'. "{PREFLIGHT}"; '
                 'release_approval_require_deployer EXPECTED_DEPLOYER "$DEPLOYER"; '
                 'mkdir "$OUTPUT"'],
                env={**os.environ, "DEPLOYER": "0x" + "A" * 40, "OUTPUT": str(output)},
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(0, valid.returncode, valid.stderr)
            self.assertTrue(output.is_dir())


class ApprovalRehearsalDiagnosticsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rehearsal = import_python_module_with_env(
            "release_approval_pty_check",
            ROOT / "tools/release_approval_pty_check.py",
            {},
        )

    def test_container_tail_preserves_both_streams_and_selected_state(self) -> None:
        identity = "a" * 64

        def logs(arguments, **options):
            self.assertEqual(
                ["docker", "logs", "--tail", "80", identity],
                arguments,
            )
            self.assertEqual(subprocess.PIPE, options.get("stdout"))
            self.assertEqual(20, options.get("timeout"))
            stdout = "Forge normal output\n"
            stderr = "Forge error on stderr\n"
            if options.get("stderr") == subprocess.STDOUT:
                return subprocess.CompletedProcess(
                    arguments, 0, stdout=stdout + stderr, stderr=None,
                )
            return subprocess.CompletedProcess(
                arguments, 0, stdout=stdout, stderr=stderr,
            )

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signer-tail.log"
            with mock.patch.object(
                self.rehearsal, "docker",
                return_value="status=running exit=0 oom=false",
            ) as inspect, mock.patch.object(
                self.rehearsal.subprocess, "run", side_effect=logs,
            ):
                self.assertEqual(path, self.rehearsal.save_container_tail(identity, path))

            inspect.assert_called_once_with(
                "inspect", "--format",
                "status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}",
                identity,
            )
            self.assertEqual(
                f"container={identity} status=running exit=0 oom=false\n"
                "Forge normal output\n"
                "Forge error on stderr\n",
                path.read_text(encoding="utf-8"),
            )
            self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))

    def test_log_failure_keeps_partial_diagnostics(self) -> None:
        identity = "b" * 64
        result = subprocess.CompletedProcess(
            ["docker", "logs", "--tail", "80", identity],
            1,
            stdout="partial container output\nlog retrieval failed\n",
            stderr=None,
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "signer-tail.log"
            with mock.patch.object(
                self.rehearsal, "docker",
                return_value="status=exited exit=137 oom=true",
            ), mock.patch.object(
                self.rehearsal.subprocess, "run", return_value=result,
            ):
                with self.assertRaisesRegex(RuntimeError, "diagnostic output saved"):
                    self.rehearsal.save_container_tail(identity, path)

            self.assertEqual(
                f"container={identity} status=exited exit=137 oom=true\n"
                "partial container output\nlog retrieval failed\n",
                path.read_text(encoding="utf-8"),
            )
            self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))

    def test_structured_docker_reads_do_not_merge_stderr(self) -> None:
        result = subprocess.CompletedProcess(
            ["docker", "inspect"],
            0,
            stdout="running\n",
            stderr="Docker diagnostic on stderr\n",
        )
        with mock.patch.object(
            self.rehearsal.subprocess, "run", return_value=result,
        ):
            self.assertEqual(
                "running",
                self.rehearsal.docker(
                    "inspect", "--format", "{{.State.Status}}", "c" * 64,
                ),
            )


class ApprovalRehearsalCancellationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rehearsal = import_python_module_with_env(
            "release_approval_pty_check",
            ROOT / "tools/release_approval_pty_check.py",
            {},
        )

    def test_selected_app_controls_the_normal_release_command(self) -> None:
        for app in ("escrow", "bike-nft", "pay-to-play"):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory, mock.patch.object(
                self.rehearsal.subprocess, "Popen", side_effect=FileNotFoundError("fixture stop"),
            ) as launch:
                with self.assertRaisesRegex(FileNotFoundError, "fixture stop"):
                    with self.rehearsal.release_terminal(Path(directory) / "approval-pty.log", app):
                        self.fail("fixture must stop at process launch")
                self.assertEqual(["make", f"{app}/release/deploy"], launch.call_args.args[0])

    def wait_for_file(self, path: Path, process: subprocess.Popen[str]) -> None:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if path.is_file():
                return
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                self.fail(f"PTY harness exited before {path.name}: {stdout}\n{stderr}")
            time.sleep(0.01)
        self.fail(f"PTY harness did not create {path.name}")

    def run_cancellation(self, signum: int, *, leader_exits: bool) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake_make = root / "fake_make.py"
            fake_make.write_text(textwrap.dedent("""\
                import os
                from pathlib import Path
                import signal
                import sys
                import time

                root = Path(sys.argv[1])
                orphan = sys.argv[2] == "orphan"
                if orphan and os.fork():
                    deadline = time.monotonic() + 10
                    while not (root / "worker-ready").exists():
                        if time.monotonic() > deadline:
                            raise SystemExit(90)
                        time.sleep(0.01)
                    print("child-ready", flush=True)
                    raise SystemExit(7)

                def cleanup(signum, _frame):
                    signal.signal(signal.SIGTERM, signal.SIG_IGN)
                    (root / "cleanup-started").write_text(str(signum))
                    # Exceed the PTY buffer: a wait without draining deadlocks.
                    sys.stdout.write("x" * 262144)
                    sys.stdout.flush()
                    while not (root / "finish-cleanup").exists():
                        time.sleep(0.01)
                    print("cleanup-complete", flush=True)
                    raise SystemExit(0)

                signal.signal(signal.SIGTERM, cleanup)
                signal.alarm(20)
                if orphan:
                    (root / "worker-ready").touch()
                else:
                    print("child-ready", flush=True)
                while True:
                    signal.pause()
                """), encoding="utf-8")
            harness = root / "harness.py"
            harness.write_text(textwrap.dedent("""\
                import importlib.util
                from pathlib import Path
                import signal
                import sys
                import time

                spec = importlib.util.spec_from_file_location("rehearsal", sys.argv[1])
                rehearsal = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(rehearsal)
                root = Path(sys.argv[2])
                mode = sys.argv[3]
                original_popen = rehearsal.subprocess.Popen

                def fake_make(_arguments, **options):
                    return original_popen(
                        [sys.executable, "-u", str(root / "fake_make.py"), str(root), mode],
                        **options,
                    )

                rehearsal.subprocess.Popen = fake_make
                rehearsal.CLEANUP_TIMEOUT = 10
                with rehearsal.release_terminal(root / "approval-pty.log", "escrow") as (master, child, transcript):
                    deadline = time.monotonic() + 10
                    while b"child-ready" not in transcript:
                        if time.monotonic() > deadline:
                            raise RuntimeError("fake make never became ready")
                        rehearsal.drain_terminal(master, transcript, 0.05)
                    if mode == "orphan":
                        while rehearsal.process_status(child) is None:
                            if time.monotonic() > deadline:
                                raise RuntimeError("fake make leader did not exit")
                            time.sleep(0.01)
                    # Cancellation happens before any approval container ID exists.
                    (root / "parent-ready").touch()
                    while True:
                        signal.pause()
                """), encoding="utf-8")
            if leader_exits:
                mode = "orphan"
            else:
                mode = "leader"
            process = subprocess.Popen(
                [sys.executable, "-u", str(harness),
                 str(ROOT / "tools/release_approval_pty_check.py"), str(root), mode],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                start_new_session=True,
            )
            try:
                self.wait_for_file(root / "parent-ready", process)
                process.send_signal(signum)
                self.wait_for_file(root / "cleanup-started", process)
                process.send_signal(signal.SIGINT)
                process.send_signal(signal.SIGHUP)
                (root / "finish-cleanup").touch()
                stdout, stderr = process.communicate(timeout=15)
                self.assertEqual(128 + signum, process.returncode, stdout + stderr)
                self.assertEqual(str(signal.SIGTERM), (root / "cleanup-started").read_text())
                log = root / "approval-pty.log"
                transcript = log.read_bytes()
                self.assertIn(b"x" * 262144, transcript)
                self.assertIn(b"cleanup-complete", transcript)
                self.assertEqual(0o600, stat.S_IMODE(log.stat().st_mode))
            finally:
                (root / "finish-cleanup").touch()
                if process.poll() is None:
                    process.send_signal(signal.SIGTERM)
                    try:
                        process.communicate(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate()

    def test_cancel_before_container_discovery_drains_teardown_and_ignores_repeated_signals(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signum=signum):
                self.run_cancellation(signum, leader_exits=False)

    def test_cancel_stops_descendant_after_group_leader_exits(self) -> None:
        self.run_cancellation(signal.SIGTERM, leader_exits=True)

    def test_launch_failure_closes_descriptors_and_restores_signal_handlers(self) -> None:
        descriptors = []
        original_openpty = self.rehearsal.pty.openpty
        handlers = {signum: signal.getsignal(signum) for signum in self.rehearsal.CANCEL_SIGNALS}

        def openpty():
            pair = original_openpty()
            descriptors.extend(pair)
            return pair

        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "approval-pty.log"
            with mock.patch.object(
                self.rehearsal.pty, "openpty", side_effect=openpty,
            ), mock.patch.object(
                self.rehearsal.subprocess, "Popen", side_effect=FileNotFoundError("fake missing make"),
            ):
                with self.assertRaisesRegex(FileNotFoundError, "fake missing make"):
                    with self.rehearsal.release_terminal(log, "escrow"):
                        self.fail("a failed child launch cannot enter the rehearsal")
            self.assertEqual(b"", log.read_bytes())
            self.assertEqual(0o600, stat.S_IMODE(log.stat().st_mode))
        for descriptor in descriptors:
            with self.assertRaises(OSError):
                os.fstat(descriptor)
        self.assertEqual(handlers, {signum: signal.getsignal(signum) for signum in handlers})

    def test_signal_during_popen_defers_until_child_handle_is_owned(self) -> None:
        child = mock.Mock()

        def launch(*_arguments, **_options):
            signal.getsignal(signal.SIGINT)(signal.SIGINT, None)
            return child

        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "approval-pty.log"
            with mock.patch.object(
                self.rehearsal.subprocess, "Popen", side_effect=launch,
            ), mock.patch.object(self.rehearsal, "stop_release") as stop:
                with self.assertRaises(SystemExit) as cancelled:
                    with self.rehearsal.release_terminal(log, "escrow"):
                        self.fail("launch-time cancellation cannot enter the rehearsal")
                self.assertEqual(130, cancelled.exception.code)
                self.assertEqual(child, stop.call_args.args[0])
                self.assertEqual(1, stop.call_count)
            self.assertEqual(b"", log.read_bytes())

    def test_cleanup_failure_keeps_transcript_and_restores_handlers(self) -> None:
        handlers = {signum: signal.getsignal(signum) for signum in self.rehearsal.CANCEL_SIGNALS}
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / "approval-pty.log"
            with mock.patch.object(
                self.rehearsal.subprocess, "Popen", return_value=mock.Mock(),
            ), mock.patch.object(
                self.rehearsal, "stop_release",
                side_effect=self.rehearsal.ReleaseCleanupError("Container cleanup is unconfirmed"),
            ):
                with self.assertRaisesRegex(self.rehearsal.ReleaseCleanupError, "unconfirmed"):
                    with self.rehearsal.release_terminal(log, "escrow") as (_master, _child, transcript):
                        transcript.extend(b"retained cancellation diagnostics\n")
                        signal.getsignal(signal.SIGTERM)(signal.SIGTERM, None)
            self.assertEqual(b"retained cancellation diagnostics\n", log.read_bytes())
            self.assertEqual(0o600, stat.S_IMODE(log.stat().st_mode))
        self.assertEqual(handlers, {signum: signal.getsignal(signum) for signum in handlers})

    def test_forced_stop_reports_unconfirmed_cleanup_instead_of_success(self) -> None:
        child = mock.Mock(pid=12345, returncode=None)
        with mock.patch.object(
            self.rehearsal, "process_status", return_value=0,
        ), mock.patch.object(
            self.rehearsal, "wait_for_exit", side_effect=[TimeoutError("still cleaning"), 0],
        ), mock.patch.object(self.rehearsal.os, "killpg") as killpg:
            with self.assertRaisesRegex(self.rehearsal.ReleaseCleanupError, "Container cleanup is unconfirmed"):
                self.rehearsal.stop_release(child, 99, bytearray())
        self.assertEqual(
            [mock.call(12345, signal.SIGTERM), mock.call(12345, signal.SIGKILL)],
            killpg.call_args_list,
        )
        child.wait.assert_called_once_with()

    def test_reaped_leader_never_signals_a_potentially_reused_group(self) -> None:
        child = mock.Mock(pid=12345, returncode=0)
        with mock.patch.object(self.rehearsal.os, "killpg") as killpg:
            with self.assertRaisesRegex(self.rehearsal.ReleaseCleanupError, "reaped early"):
                self.rehearsal.stop_release(child, 99, bytearray())
        killpg.assert_not_called()


if __name__ == "__main__":
    unittest.main()
