from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT


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


if __name__ == "__main__":
    unittest.main()
