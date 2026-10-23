from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .common import ROOT


NEW = "sha256:" + "b" * 64
OLD = "sha256:" + "a" * 64
BUSY = "sha256:" + "c" * 64
SOURCE = "a" * 40
STUBS = r'''
docker() {
  printf '%s\n' "$*" >> "$CASE_ROOT/docker-calls"
  if [[ "$1 $2" == 'image ls' ]]; then
    printf '%s\n' "$OLD_IMAGE" "$NEW_IMAGE" "$BUSY_IMAGE" "sha256:$(printf 'd%.0s' {1..64})"
  elif [[ "$1 $2 $3" == 'image inspect --format' ]]; then
    shift 4
    local image entrypoint
    for image in "$@"; do
      entrypoint='["node","--experimental-strip-types","/app/tools/release-approval/run.ts"]'
      if [[ "$image" == "sha256:$(printf 'd%.0s' {1..64})" ]]; then entrypoint=null; fi
      printf '%s\t%s\t%s\n' "$image" "$TEST_SOURCE" "$entrypoint"
    done
  elif [[ "$1 $2" == 'image rm' ]]; then
    [[ "$#" == 4 && "$3" == --no-prune ]] || return 91
    if [[ "$4" == "$BUSY_IMAGE" && "$REFUSE_BUSY" == 1 ]]; then
      printf '%s\n' 'fixture: image is used by a running container' >&2
      return 1
    fi
    printf 'Deleted: %s\n' "$4"
  else return 92; fi
}
'''


class ApprovalImageOperatorTest(unittest.TestCase):
    def environment(self, root: Path, *, refuse_busy: bool) -> dict[str, str]:
        environment = {**os.environ, "CASE_ROOT": str(root), "NEW_IMAGE": NEW, "OLD_IMAGE": OLD,
                       "BUSY_IMAGE": BUSY, "TEST_SOURCE": SOURCE, "REFUSE_BUSY": str(int(refuse_busy))}
        for name in ("SOURCE_COMMIT", "RELEASE_APPROVAL_IMAGE_OUTPUT_DIR", "MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES"):
            if name in environment:
                del environment[name]
        return environment

    def run_shell(self, script: str, environment: dict[str, str]) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", STUBS + script], cwd=ROOT,
                              env=environment, input="", capture_output=True, text=True, check=False, timeout=10)

    def test_retirement_excludes_the_new_image_and_uses_nonforcing_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_shell(r'''
source tools/release_approval_images.sh
old_images="$(printf '%s\t%s\n' "$OLD_IMAGE" "$TEST_SOURCE" "$NEW_IMAGE" "$TEST_SOURCE" "$BUSY_IMAGE" "$TEST_SOURCE")"
release_approval_retire_images "$NEW_IMAGE" "$old_images"
''', self.environment(root, refuse_busy=False))
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertEqual([f"image rm --no-prune {OLD}", f"image rm --no-prune {BUSY}"],
                             (root / "docker-calls").read_text().splitlines())
            self.assertIn(OLD, result.stdout + result.stderr)
            self.assertIn(NEW, result.stdout + result.stderr)

    def test_retirement_keeps_in_use_images_and_reports_native_refusal(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_shell(r'''
source tools/release_approval_images.sh
old_images="$(printf '%s\t%s\n' "$BUSY_IMAGE" "$TEST_SOURCE" "$OLD_IMAGE" "$TEST_SOURCE")"
release_approval_retire_images "$NEW_IMAGE" "$old_images"
''', self.environment(root, refuse_busy=True))
            self.assertNotEqual(0, result.returncode)
            self.assertIn("image is used by a running container", result.stderr)
            self.assertEqual([f"image rm --no-prune {BUSY}", f"image rm --no-prune {OLD}"],
                             (root / "docker-calls").read_text().splitlines())

    def test_operator_target_defaults_and_retires_only_after_success(self):
        for outcome in ("success", "build-failure", "publish-failure", "explicit"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                environment = self.environment(root, refuse_busy=False)
                environment["BUILD_OUTCOME"] = outcome
                if outcome == "explicit":
                    environment.update(SOURCE_COMMIT="e" * 40, RELEASE_APPROVAL_IMAGE_OUTPUT_DIR=str(root / "explicit-output"))
                generated = subprocess.run(
                    ["make", "--no-print-directory", "--dry-run", "release/approval/image/build", "LANE_GUARD=:"],
                    cwd=ROOT, env=environment, capture_output=True, text=True, check=True,
                )
                script = r'''
realpath() { local last; for last; do :; done; printf '%s\n' "$last"; }
git() {
  [[ "$1" == rev-parse ]] || return 93
  local revision="${@: -1}"
  if [[ "$revision" == HEAD ]]; then printf '%s\n' "$TEST_SOURCE";
  else printf '%s\n' "$revision"; fi
}
timeout() {
  while [[ "$1" != bash ]]; do shift; done
  "$@"
}
bash() {
  [[ "$1" == tools/release_approval_image_build.sh && "$#" == 3 ]] || return 94
  printf '%s\n' "$2" > "$CASE_ROOT/source"
  printf '%s\n' "$3" > "$CASE_ROOT/output"
  if [[ "$BUILD_OUTCOME" == build-failure ]]; then return 23; fi
  if [[ "$BUILD_OUTCOME" == publish-failure ]]; then return 24; fi
  mkdir "$3" || return 95
  touch "$3/.test-owned-output"
  printf '{"imageId":"%s"}\n' "$NEW_IMAGE" > "$3/approval-image.json"
  printf '%s\n' "$NEW_IMAGE"
}
''' + generated.stdout
                output = None
                try:
                    result = self.run_shell(script, environment)
                    if (root / "output").exists():
                        output = Path((root / "output").read_text().strip())
                    self.assertIsNotNone(output, result.stdout + result.stderr)
                    calls = (root / "docker-calls").read_text().splitlines()
                    removals = [call for call in calls if call.startswith("image rm ")]
                    if outcome in ("build-failure", "publish-failure"):
                        self.assertNotEqual(0, result.returncode)
                        self.assertEqual([], removals)
                        continue
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertEqual([f"image rm --no-prune {OLD}", f"image rm --no-prune {BUSY}"], removals)
                    expected_source = SOURCE
                    if outcome == "explicit":
                        expected_source = "e" * 40
                    self.assertEqual(expected_source, (root / "source").read_text().strip())
                    if outcome == "explicit":
                        self.assertEqual(root / "explicit-output", output)
                    else:
                        self.assertTrue(output.is_relative_to(Path(os.environ["HOME"]) / "Documents"))
                        self.assertRegex(str(output.relative_to(Path(os.environ["HOME"]) / "Documents")), r"\d{8}")
                    self.assertTrue((output / "approval-image.json").is_file())
                finally:
                    if output is not None and (output / ".test-owned-output").is_file():
                        shutil.rmtree(output)
