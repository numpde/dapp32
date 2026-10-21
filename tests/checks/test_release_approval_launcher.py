from __future__ import annotations

import os
from pathlib import Path
import stat
import subprocess
import tempfile
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


if __name__ == "__main__":
    unittest.main()
