"""Exercise viewer export and teardown through the real Bash entrypoint."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .common import ROOT


class ViewerImageBuildTest(unittest.TestCase):
    # silent-defaults: allow-default -- Cases override only the simulated failure or source state they exercise.
    def build(self, directory: str, *, build_status: int = 0, cleanup_status: int = 0, modified: bool = False):
        # Shell peers replace engine and Git access; the launcher and its EXIT
        # trap remain real, including preservation of the primary failure.
        wrapper = r'''
git() {
  case "$*" in *rev-parse*) printf '%040d\n' 1 ;; *status*) printf '%s' "$SOURCE_CHANGES" ;; *) return 99 ;; esac
}
docker() {
  printf '%s\n' "$*" >> "$CASE_ROOT/calls"
  shift 2
  if [[ $1 == compose ]]; then
    case " $* " in
      *' down '*) return "$CLEANUP_STATUS" ;;
      *' build '*) return "$BUILD_STATUS" ;;
    esac
  elif [[ $1 == cp ]]; then
    mkdir -p "${@: -1}/site"
    printf 'viewer' > "${@: -1}/site/index.html"
  fi
}
timeout() {
  if [[ $1 == -k ]]; then shift 2; fi
  shift
  "$@"
}
export -f git docker timeout
exec bash "$@"
'''
        environment = dict(os.environ, CASE_ROOT=directory, BUILD_STATUS=str(build_status),
                           CLEANUP_STATUS=str(cleanup_status), SOURCE_CHANGES=" M source" if modified else "",
                           VITE_CAM_WEB_BUILD_REVISION="caller", VITE_CAM_WEB_BUILD_MODIFIED="caller",
                           VIEWER_COMPOSE_PROJECT_NAME="fixture-viewer",
                           CAM_DOCKER_ENDPOINT="unix:///tmp/fixture.sock")
        result = subprocess.run(["bash", "-c", wrapper, "fixture", str(ROOT / "tools/viewer_image_build.sh"),
                                 "cam-viewer:test"], env=environment, capture_output=True, text=True, timeout=10)
        return result, (Path(directory) / "calls").read_text()

    def test_success_exports_image_and_retires_compiler_image(self):
        with tempfile.TemporaryDirectory() as directory:
            result, calls = self.build(directory)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("--tag cam-viewer:test", calls)
            self.assertIn("--build-arg VIEWER_REVISION=" + "0" * 39 + "1", calls)
            self.assertIn("--build-arg VIEWER_MODIFIED=false", calls)
            self.assertIn("down --timeout 10 --volumes --remove-orphans --rmi local", calls)

    def test_failed_build_still_retires_compiler_resources(self):
        with tempfile.TemporaryDirectory() as directory:
            result, calls = self.build(directory, build_status=7)
            self.assertEqual(7, result.returncode, result.stderr)
            self.assertIn("--rmi local", calls)
            self.assertNotIn("--tag cam-viewer:test", calls)

    def test_modified_source_cannot_inherit_a_callers_clean_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            result, calls = self.build(directory, modified=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("--build-arg VIEWER_MODIFIED=true", calls)
            self.assertNotIn("VIEWER_REVISION=caller", calls)

    def test_cleanup_failure_is_reported_without_hiding_build_failure(self):
        for build_status, expected in ((0, 1), (7, 7)):
            with self.subTest(build_status=build_status), tempfile.TemporaryDirectory() as directory:
                result, _ = self.build(directory, build_status=build_status, cleanup_status=9)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertIn("temporary files retained", result.stderr)
                # This fixture has no mounted consumers after its fake failure.
                retained = result.stderr.split("temporary files retained at ")[-1].strip().rstrip(".")
                shutil.rmtree(retained)
