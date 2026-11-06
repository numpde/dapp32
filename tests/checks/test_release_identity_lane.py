"""Exercise the live identity lane's ownership and cleanup without a real engine."""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from .common import ROOT


DOCKER = r'''import json, os, pathlib, runpy, sys, time
args = sys.argv[1:]
assert args[:2] == ["--host", "unix:///tmp/identity-lane-fixture.sock"], args
args = args[2:]
case = pathlib.Path(os.environ["CASE_ROOT"])
with (case / "calls").open("a") as stream:
    stream.write(json.dumps(args) + "\n")
mode = os.environ["CASE_MODE"]
if args[:2] == ["image", "inspect"]:
    print("sha256:" + "a" * 64)
elif args[0] == "compose" and "run" in args:
    directory = pathlib.Path(os.environ["RELEASE_IDENTITY_CHECK_DIR"])
    (case / "workspace").write_text(str(directory))
    if mode == "blocked":
        (case / "entered").touch()
        time.sleep(30)
    if mode == "worker-failure":
        raise SystemExit(19)
    runpy.run_path(os.environ["PAYLOAD"])["private_round_trip"](directory / "private")
    if mode == "wrong-mode":
        (directory / "private" / "record").chmod(0o644)
elif args[0] == "compose" and "down" in args:
    if mode == "cleanup-failure":
        print("fixture teardown refused", file=sys.stderr)
        raise SystemExit(7)
elif args[0] in ("container", "network", "volume") and args[1] == "ls":
    if mode == "cleanup-failure" and args[0] == "container":
        print("b" * 64)
else:
    raise AssertionError(args)
'''


class IdentityLaneTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.case = Path(temporary.name)
        self.checkout = self.case / "checkout"
        (self.checkout / "tools").mkdir(parents=True)
        for name in ("release_identity_check.sh", "release_identity.sh", "release_process.sh",
                     "release_tool_images.sh", "compose_cleanup.sh"):
            shutil.copyfile(ROOT / "tools" / name, self.checkout / "tools" / name)
        (self.checkout / "tools/docker_context.sh").write_text(
            'printf "%s\n" "$*" >> "$CASE_ROOT/selector-calls"\n'
            'case "$*" in\n'
            '  "command line fixture undefined  0"|"undefined  command line unix:///tmp/identity-lane-fixture.sock 1") ;;\n'
            '  *) exit 2 ;;\n'
            'esac\n'
            'printf "%s\\n" unix:///tmp/identity-lane-fixture.sock\n'
        )
        (self.case / "docker.py").write_text(DOCKER)
        timeout = shutil.which("timeout")
        help_result = subprocess.run([timeout, "--help"], capture_output=True,
                                     text=True, timeout=5)
        timeout_help = help_result.stdout + help_result.stderr
        self.assertTrue("--foreground" in timeout_help or "BusyBox" in timeout_help,
                        "The fixture needs GNU or BusyBox timeout")
        self.environment = {**os.environ, "CASE_ROOT": str(self.case), "CASE_MODE": "success",
            "PAYLOAD": str(ROOT / "tests/live/check_release_identity.py"),
            "PYTHON": sys.executable, "REAL_SETSID": shutil.which("setsid"),
            "REAL_TIMEOUT": timeout,
            "TIMEOUT_IS_BUSYBOX": "1" if "BusyBox" in timeout_help else "0"}
        self.wrapper = r'''
docker() { "$PYTHON" "$CASE_ROOT/docker.py" "$@"; }
python3() {
  if [[ "${1-}" == -I && "${2-}" == -S && "${3-}" == -B && "${4-}" == tools/release_identity.py ]]; then
    printf '%s:%s\n' "$(id -u)" "$(id -g)"
  else
    "$PYTHON" "$@"
  fi
}
timeout() {
  local -a before=()
  while [[ $# -gt 0 && "$1" != docker && "$1" != bash ]]; do
    # The Alpine checker has BusyBox timeout, which already preserves the
    # command's process group. GNU timeout needs --foreground to do so.
    if [[ "$1" != --foreground || "$TIMEOUT_IS_BUSYBOX" != 1 ]]; then before+=("$1"); fi
    shift
  done
  if [[ "$1" == docker ]]; then
    shift
    "$REAL_TIMEOUT" "${before[@]}" "$PYTHON" "$CASE_ROOT/docker.py" "$@"
  else
    "$REAL_TIMEOUT" "${before[@]}" "$@"
  fi
}
setsid() { exec "$REAL_SETSID" bash -c '"$@"' identity-child "$@"; }
export -f docker python3 timeout setsid
exec bash tools/release_identity_check.sh fixture
'''

    def run_lane(self, mode, *, selected=False):
        command = self.wrapper
        environment = {**self.environment, "CASE_MODE": mode}
        if selected:
            command = command.replace(
                "exec bash tools/release_identity_check.sh fixture",
                "exec bash tools/release_identity_check.sh --selected",
            )
            environment["CAM_DOCKER_ENDPOINT"] = "unix:///tmp/identity-lane-fixture.sock"
        result = subprocess.run(["bash", "-c", command], cwd=self.checkout,
            env=environment, capture_output=True, text=True, timeout=12)
        marker = self.case / "workspace"
        self.assertTrue(marker.is_file(), result.stdout + result.stderr)
        directory = Path(marker.read_text())
        self.addCleanup(shutil.rmtree, directory, True)
        return result, directory

    def test_ci_calls_the_same_lane_without_reimplementing_the_round_trip(self):
        workflow = (ROOT / ".github/workflows/identity-integration.yml").read_text()
        self.assertIn("run: make tests/live/release-identity DOCKER_CONTEXT=default", workflow)
        self.assertNotIn("run: bash tools/release_identity_check.sh", workflow)
        self.assertNotIn("docker --host", workflow)
        self.assertNotIn("python3 -I -B -c", workflow)

    def test_success_requires_private_round_trip_and_confirmed_retirement(self):
        result, directory = self.run_lane("success")
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("PASS", result.stdout)
        self.assertIsNotNone(directory)
        self.assertFalse(directory.exists())
        calls = [json.loads(line) for line in (self.case / "calls").read_text().splitlines()]
        self.assertTrue(any("run" in call for call in calls))
        self.assertTrue(any("down" in call for call in calls))
        self.assertEqual(["container", "network", "volume"], [call[0] for call in calls[-3:]])

    def test_make_handoff_uses_preselected_endpoint_without_reinspection(self):
        result, directory = self.run_lane("success", selected=True)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("PASS", result.stdout)
        self.assertFalse(directory.exists())
        self.assertEqual(
            ["undefined  command line unix:///tmp/identity-lane-fixture.sock 1"],
            (self.case / "selector-calls").read_text().splitlines(),
        )

    def test_make_handoff_rejects_untrusted_remote_endpoint_before_execution(self):
        script = self.wrapper.replace(
            "exec bash tools/release_identity_check.sh fixture",
            "exec bash tools/release_identity_check.sh --selected",
        )
        env = {**self.environment, "CAM_DOCKER_ENDPOINT": "tcp://remote.invalid:2375"}
        result = subprocess.run(["bash", "-c", script], cwd=self.checkout,
                                env=env, capture_output=True, text=True, timeout=12)
        self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertNotIn("PASS", result.stdout)
        self.assertFalse((self.case / "workspace").exists())
        self.assertFalse((self.case / "calls").exists())

    def test_worker_failure_is_not_reported_as_success_and_still_cleans_up(self):
        result, directory = self.run_lane("worker-failure")
        self.assertEqual(19, result.returncode, result.stdout + result.stderr)
        self.assertNotIn("PASS", result.stdout)
        self.assertFalse(directory.exists())

    def test_host_checks_reject_incorrect_output_permissions(self):
        result, directory = self.run_lane("wrong-mode")
        self.assertNotEqual(0, result.returncode)
        self.assertNotIn("PASS", result.stdout)
        self.assertFalse(directory.exists())

    def test_unconfirmed_cleanup_retains_its_inputs_and_diagnostics(self):
        result, directory = self.run_lane("cleanup-failure")
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertNotIn("PASS", result.stdout)
        self.assertIn(str(directory), result.stderr)
        self.assertTrue(directory.is_dir())
        self.assertIn("fixture teardown refused", (directory / "cleanup.log").read_text())

    def test_cancellation_retires_the_worker_before_removing_private_inputs(self):
        process = subprocess.Popen(["bash", "-c", self.wrapper], cwd=self.checkout,
            env={**self.environment, "CASE_MODE": "blocked"}, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while not (self.case / "entered").exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.case / "entered").exists())
            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=20)
            directory = Path((self.case / "workspace").read_text())
            self.addCleanup(shutil.rmtree, directory, True)
            self.assertEqual(143, process.returncode, stdout + stderr)
            self.assertNotIn("PASS", stdout)
            self.assertFalse(directory.exists())
        finally:
            if process.poll() is None:
                process.kill()
            process.communicate()
