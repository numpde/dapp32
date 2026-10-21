from __future__ import annotations

import os
from pathlib import Path
import pty
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import termios
import time
import unittest

from .common import ROOT


PROCESS = ROOT / "tools/release_process.sh"
LAUNCHER = ROOT / "tools/release_approval_deploy.sh"
CONFIG = ROOT / "tools/release-config.sh"


def make_cleanup() -> str:
    source = (ROOT / "Makefile").read_text(encoding="utf-8")
    match = re.search(r"(?ms)^define release_snapshot_cleanup\n(.*?)\nendef$", source)
    if match is None:
        raise AssertionError("shared release cleanup is missing")
    return match.group(1).replace("$$", "$").replace("\\\n", "")


# The worker reaps its plugin child itself. The checks Python can be container
# PID 1, so deliberately orphaning test grandchildren would leave zombies.
WORKER = r"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(os.environ["CASE_ROOT"])
stopping = False
def stop(_signal, _frame):
    global stopping
    stopping = True
signal.signal(signal.SIGTERM, stop)
plugin = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
(root / "worker.pid").write_text(str(os.getpid()))
(root / "plugin.pid").write_text(str(plugin.pid))
(root / "ready").touch()
while not stopping:
    time.sleep(0.02)
plugin.terminate()
plugin.wait(timeout=3)
with (root / "events").open("a") as stream:
    stream.write("worker-stopped\n")
raise SystemExit(int(os.environ["WORKER_STATUS"]))
"""

FAKE_DOCKER = r"""
import os
from pathlib import Path
import select
import signal
import socket
import sys
import time
import tty

root = Path(os.environ["CASE_ROOT"])
args = sys.argv[1:]
if args[0] == "attach":
    (root / "attachment.pid").write_text(str(os.getpid()))
    def stop(_signal, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, stop)
    tty.setraw(0)
    sock = None
    if os.environ["ATTACH_PHASE"] == "review":
        sock = socket.socket(socket.AF_UNIX)
        sock.bind(str(root / "socket/rpc.sock"))
    (root / "attached").touch()
    try:
        while not (root / "stopped").exists():
            ready, _, _ = select.select([0], [], [], 0.05)
            if ready and os.read(0, 1) in (b"\x03", b""):
                break
    finally:
        if sock is not None:
            sock.close()
        (root / "attachment-ended").touch()
    raise SystemExit(0)
if args[0] == "inspect":
    value = args[2]
    if value == "{{.State.Running}}":
        print("true")
    elif value == "{{.State.Health.Status}}":
        print("healthy")
    elif value == "{{.State.Status}} {{.State.ExitCode}}":
        print("running 0")
    elif value == "{{.State.ExitCode}}":
        print("0")
    else:
        raise SystemExit(91)
    raise SystemExit(0)
raise SystemExit(92)
"""

SHELL_SETUP = r"""
source "$PROCESS"
release_process_init
release_command_grace=2
source "$CONFIG_SOURCE"
ceremony_root="$CEREMONY"
ceremony_source="$ceremony_root/source"
mkdir -p "$ceremony_source" "$CASE_ROOT/config"
release_config_dir="$CASE_ROOT/config"
printf 'fixture input\n' > "$release_config_dir/rpc-url"
release_rpc_started=1
release_dependencies_started=1
release_check_started=1
release_run_started=1
fake_down() {
  local name="$1"
  [[ -d "$ceremony_source" ]] || return 91
  if [[ -f "$CASE_ROOT/worker.pid" ]]; then
    local worker_pid
    read -r worker_pid < "$CASE_ROOT/worker.pid"
    if kill -0 "$worker_pid" 2>/dev/null || kill -0 -- "-$worker_pid" 2>/dev/null; then
      printf '%s\n' live-worker-at-down >> "$CASE_ROOT/events"
      return 92
    fi
  fi
  printf 'down:%s\n' "$name" >> "$CASE_ROOT/events"
  # Repeated terminal interrupts must not abort later teardown projects.
  if [[ "$REPEAT_SIGNALS" == 1 ]]; then
    kill -INT "$BASHPID"
    kill -TERM "$BASHPID"
    kill -HUP "$BASHPID"
  fi
  [[ "$FAIL_DOWN" != "$name" ]]
}
compose_release() { fake_down run; }
compose_release_check() { fake_down check; }
compose_release_dependencies() { fake_down dependencies; }
compose_release_rpc() { fake_down rpc; }
release_config_teardown() { fake_down config; }
"""


class ReleaseLifecycleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        # Bash is a pinned checks-image dependency. Never silently skip this
        # regression when the supported test runtime loses that dependency.
        cls.bash = shutil.which("bash")
        if cls.bash is None or shutil.which("setsid") is None:
            raise AssertionError("release lifecycle checks require Bash and setsid")

    def environment(self, root: Path, ceremony: Path) -> dict[str, str]:
        return {
            **os.environ,
            "PROCESS": str(PROCESS),
            "LAUNCHER": str(LAUNCHER),
            "CONFIG_SOURCE": str(CONFIG),
            "PYTHON": sys.executable,
            "CASE_ROOT": str(root),
            "CEREMONY": str(ceremony),
            "LOCAL_UID": str(os.getuid()),
            "WORKER_STATUS": "143",
            "FAIL_DOWN": "",
            "REPEAT_SIGNALS": "0",
        }

    def wait_path(self, path: Path, process: subprocess.Popen[str]) -> None:
        deadline = time.monotonic() + 8
        while not path.exists():
            if process.poll() is not None:
                stdout, stderr = process.communicate()
                self.fail(f"launcher ended before {path.name}: {stdout}\n{stderr}")
            if time.monotonic() >= deadline:
                self.fail(f"launcher did not reach {path.name}")
            time.sleep(0.02)

    def emergency_cleanup(self, process: subprocess.Popen[str], root: Path) -> None:
        # Only PIDs created and recorded by this fixture are eligible.
        (root / "stopped").touch()
        for name in ("worker.pid", "attachment.pid", "plugin.pid", "cleanup.pid"):
            path = root / name
            if path.exists():
                pid = int(path.read_text())
                try:
                    os.kill(pid, signal.SIGTERM)
                # silent-defaults: allow-exception-fallback -- Test-owned children may already be reaped; an absent recorded PID needs no termination.
                except ProcessLookupError:
                    pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=4)

    def launch(self, script: str, env: dict[str, str], *, stdin=None) -> subprocess.Popen[str]:
        # /tmp is noexec in compose/checks.yml: all temporary programs are
        # interpreted explicitly; there are no executable fake PATH files.
        return subprocess.Popen(
            [self.bash, "-eu", "-o", "pipefail", "-c", script],
            env=env, stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True,
        )

    def cancellation_case(
        self, signum: int, *, fail_down: str, child_status: str,
        before_setsid: bool,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(
            prefix=f"cam-release-{os.getuid()}-", dir="/tmp",
        ) as ceremony_directory:
            root, ceremony = Path(directory), Path(ceremony_directory)
            (root / "worker.py").write_text(WORKER, encoding="utf-8")
            unrelated = root / "unrelated-container"
            unrelated.touch()
            env = self.environment(root, ceremony)
            env.update(FAIL_DOWN=fail_down, WORKER_STATUS=child_status, REPEAT_SIGNALS="1")
            script = SHELL_SETUP + "\ncleanup() {\n" + make_cleanup() + "\n}\ntrap cleanup EXIT\n"
            if before_setsid:
                # Model the owned child before setsid creates its process group.
                # The child PID fallback must still stop and reap it.
                script += 'setsid() { exec "$@"; }\n'
            script += 'release_run_owned 2 "$PYTHON" "$CASE_ROOT/worker.py" > "$CASE_ROOT/command.log" 2>&1\n'
            process = self.launch(script, env)
            try:
                self.wait_path(root / "ready", process)
                process.send_signal(signum)
                stdout, stderr = process.communicate(timeout=10)
            finally:
                self.emergency_cleanup(process, root)
            failed = bool(fail_down) or child_status == "2"
            expected_status = 128 + signum
            if failed:
                expected_status = 2
            self.assertEqual(expected_status, process.returncode, stdout + stderr)
            events = (root / "events").read_text().splitlines()
            self.assertEqual(
                ["worker-stopped", "down:run", "down:check", "down:dependencies", "down:rpc", "down:config"],
                events,
            )
            self.assertEqual(failed, ceremony.exists())
            self.assertEqual(failed, (root / "config/rpc-url").exists())
            self.assertTrue(unrelated.exists())
            if failed:
                self.assertIn("retained", stderr)
                self.assertNotIn("retained", (root / "command.log").read_text())

    def test_parent_signals_stop_plugin_before_all_owned_projects(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            with self.subTest(signal=signum):
                self.cancellation_case(signum, fail_down="", child_status="143", before_setsid=False)

    def test_parent_signal_before_setsid_still_reaps_owned_pid(self) -> None:
        self.cancellation_case(signal.SIGTERM, fail_down="", child_status="143", before_setsid=True)

    def test_failed_down_retains_source_and_inputs_after_other_teardowns(self) -> None:
        self.cancellation_case(signal.SIGTERM, fail_down="run", child_status="143", before_setsid=False)

    def test_inner_cleanup_failure_retains_outer_inputs(self) -> None:
        self.cancellation_case(signal.SIGINT, fail_down="", child_status="2", before_setsid=False)

    def test_cleanup_command_has_a_wall_clock_limit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = self.environment(root, root)
            script = r"""
source "$PROCESS"
release_process_init
release_process_cleanup_begin
release_run_owned 1 "$PYTHON" -c 'import os, time; from pathlib import Path; Path(os.environ["CASE_ROOT"]).joinpath("cleanup.pid").write_text(str(os.getpid())); time.sleep(60)'
"""
            started = time.monotonic()
            process = self.launch(script, env)
            try:
                stdout, stderr = process.communicate(timeout=5)
            finally:
                self.emergency_cleanup(process, root)
            self.assertNotEqual(0, process.returncode, stdout + stderr)
            self.assertLess(time.monotonic() - started, 5)

    def test_ctrl_c_forwarded_to_attachment_cancels_before_or_during_review(self) -> None:
        for phase in ("start", "review"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(
                prefix=f"cam-release-{os.getuid()}-", dir="/tmp",
            ) as ceremony_directory:
                root, ceremony = Path(directory), Path(ceremony_directory)
                (root / "socket").mkdir()
                (root / "output").mkdir()
                (root / "fake_docker.py").write_text(FAKE_DOCKER, encoding="utf-8")
                env = self.environment(root, ceremony)
                env["ATTACH_PHASE"] = phase
                script = SHELL_SETUP + "\n" + r"""
source "$LAUNCHER"
RELEASE_APPROVAL_SOCKET_DIR="$CASE_ROOT/socket"
docker() {
  if [[ "$1" == attach ]]; then exec "$PYTHON" "$CASE_ROOT/fake_docker.py" "$@"; fi
  "$PYTHON" "$CASE_ROOT/fake_docker.py" "$@"
}
release_approval_show_startup() { return 0; }
compose_release() {
  local action="$1" service=""
  for service in "$@"; do :; done
  case "$action" in
    up)
      [[ ! -f "$CASE_ROOT/down" ]] || return 94
      printf 'up:%s\n' "$service" >> "$CASE_ROOT/events"
      if [[ "$service" == deploy-release ]]; then touch "$CASE_ROOT/signer"; fi
      ;;
    ps) printf '%064d\n' 1 ;;
    stop) touch "$CASE_ROOT/stopped" ;;
    logs) printf '%s\n' 'fixture Forge output' ;;
    down)
      touch "$CASE_ROOT/down"
      [[ -f "$CASE_ROOT/attachment-ended" ]] || return 95
      fake_down run
      ;;
    *) return 93 ;;
  esac
}
"""
                script += "\ncleanup() {\n" + make_cleanup() + "\n}\ntrap cleanup EXIT\n"
                script += 'release_approval_run "$CASE_ROOT/output"\n'
                master, slave = pty.openpty()
                original_terminal = termios.tcgetattr(slave)
                process = self.launch(script, env, stdin=slave)
                try:
                    self.wait_path(root / "attached", process)
                    if phase == "review":
                        self.wait_path(root / "signer", process)
                    # Docker's raw attachment receives byte 0x03; this does not
                    # send SIGINT to the host launcher.
                    os.write(master, b"\x03")
                    stdout, stderr = process.communicate(timeout=10)
                    self.assertEqual(original_terminal, termios.tcgetattr(slave))
                finally:
                    self.emergency_cleanup(process, root)
                    os.close(master)
                    os.close(slave)
                self.assertEqual(1, process.returncode, stdout + stderr)
                events = (root / "events").read_text().splitlines()
                self.assertEqual(1, events.count("up:release-approval"))
                expected_signers = 0
                if phase == "review":
                    expected_signers = 1
                self.assertEqual(expected_signers, events.count("up:deploy-release"))
                self.assertEqual(
                    ["down:run", "down:check", "down:dependencies", "down:rpc", "down:config"],
                    [event for event in events if event.startswith("down:")],
                )
                self.assertFalse(ceremony.exists())
                self.assertTrue((root / "attachment-ended").exists())
                self.assertEqual("unknown\n", (root / "output/forge-exit-code").read_text())
                self.assertIn("fixture Forge output", (root / "output/deploy.log").read_text())
                self.assertIn("Review broadcast and approval audit for possible earlier effects.", stderr)

    def test_config_staging_stops_converter_before_removing_inputs(self) -> None:
        projects = []
        for fail_down in ("", "config"):
            with self.subTest(fail_down=fail_down), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "worker.py").write_text(WORKER, encoding="utf-8")
                env = self.environment(root, root)
                env["FAIL_DOWN"] = fail_down
                script = r"""
source "$PROCESS"
release_process_init
release_command_grace=2
source "$CONFIG_SOURCE"
compose_release_config() {
  [[ "$1" == down && -d "$release_config_dir" ]] || return 91
  local worker_pid
  read -r worker_pid < "$CASE_ROOT/worker.pid"
  if kill -0 "$worker_pid" 2>/dev/null; then return 92; fi
  printf '%s\n' "$release_config_project" > "$CASE_ROOT/project"
  [[ "$FAIL_DOWN" != config ]]
}
release_config_stage "$CASE_ROOT"
printf '%s\n' "$release_config_dir" > "$CASE_ROOT/stage"
printf 'fixture input\n' > "$release_config_dir/rpc-url"
release_config_started=1
release_run_owned 2 "$PYTHON" "$CASE_ROOT/worker.py"
"""
                process = self.launch(script, env)
                try:
                    self.wait_path(root / "ready", process)
                    process.send_signal(signal.SIGTERM)
                    stdout, stderr = process.communicate(timeout=10)
                finally:
                    self.emergency_cleanup(process, root)
                expected_status = 143
                if fail_down:
                    expected_status = 2
                self.assertEqual(expected_status, process.returncode, stdout + stderr)
                stage = Path((root / "stage").read_text().strip())
                self.assertEqual(bool(fail_down), stage.exists())
                project = (root / "project").read_text().strip()
                self.assertRegex(project, r"^cam-release-config-[0-9a-f]{24}$")
                projects.append(project)
        self.assertNotEqual(*projects)

    def test_startup_failure_retains_private_bounded_diagnostics_before_teardown(self) -> None:
        for case in ("exited", "incomplete", "large", "log-failure", "existing-file", "head-failure"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(
                prefix=f"cam-release-{os.getuid()}-", dir="/tmp",
            ) as ceremony_directory:
                root, ceremony = Path(directory), Path(ceremony_directory)
                output = root / "output"
                output.mkdir()
                diagnostic = output / "approval-diagnostics.log"
                if case == "existing-file":
                    diagnostic.write_text("existing operator file\n")
                env = self.environment(root, ceremony)
                env["STARTUP_CASE"] = case
                script = SHELL_SETUP + "\n" + r'''
source "$LAUNCHER"
docker() {
  if [[ "$1" == logs ]]; then
    if [[ "$3" == 16 ]]; then
      case "$STARTUP_CASE" in
        incomplete) printf '%s\n' 'Type start and press Enter to open the approval socket.' ;;
        *) printf '%s\n' 'private startup failure' >&2 ;;
      esac
    else
      printf '%s\n' 'private startup failure' >&2
      if [[ "$STARTUP_CASE" == large ]]; then "$PYTHON" -c 'print("x" * 262144)'; fi
      if [[ "$STARTUP_CASE" == log-failure ]]; then return 9; fi
    fi
  elif [[ "$1" == inspect ]]; then
    if [[ "$3" == '{{.State.Running}}' ]]; then printf '%s\n' false
    else printf '%s\n' 'status=exited exit=1 oom=false'; fi
  else return 91
  fi
}
# Only the external Docker boundary is faked; no Docker daemon is available in checks.
timeout() { shift 2; "$@"; }
if [[ "$STARTUP_CASE" == head-failure ]]; then head() { command head "$@"; return 9; }; fi
compose_release() {
  case "$1" in
    up) printf 'up:%s\n' "${@: -1}" >> "$CASE_ROOT/events" ;;
    ps) printf '%064d\n' 1 ;;
    down)
      if [[ -f "$CASE_ROOT/output/approval-diagnostics.log" ]]; then
        printf '%s\n' retained-before-down >> "$CASE_ROOT/events"
      fi
      fake_down run ;;
    *) return 92 ;;
  esac
}
'''
                script += "\ncleanup() {\n" + make_cleanup() + "\n}\ntrap cleanup EXIT\n"
                script += 'release_approval_run "$CASE_ROOT/output"\n'
                process = self.launch(script, env)
                try:
                    stdout, stderr = process.communicate(timeout=10)
                finally:
                    self.emergency_cleanup(process, root)
                self.assertEqual(1, process.returncode, stdout + stderr)
                self.assertNotIn("private startup failure", stdout + stderr)
                self.assertTrue(diagnostic.is_file(), stdout + stderr)
                contents = diagnostic.read_text()
                if case == "existing-file":
                    self.assertEqual("existing operator file\n", contents)
                else:
                    self.assertIn("status=exited exit=1 oom=false", contents)
                    self.assertIn("private startup failure", contents)
                    self.assertLessEqual(diagnostic.stat().st_size, 65536)
                    self.assertEqual(0o600, diagnostic.stat().st_mode & 0o777)
                if case in ("log-failure", "existing-file", "head-failure"):
                    self.assertIn("diagnostics", stderr.lower())
                    self.assertIn("could not", stderr.lower())
                else:
                    self.assertIn(str(diagnostic), stdout + stderr)
                events = (root / "events").read_text().splitlines()
                self.assertLess(events.index("retained-before-down"), events.index("down:run"))
                self.assertNotIn("up:deploy-release", events)
                self.assertEqual(5, sum(event.startswith("down:") for event in events))
                self.assertFalse(ceremony.exists())
                self.assertFalse((output / "forge-exit-code").exists())


if __name__ == "__main__":
    unittest.main()
