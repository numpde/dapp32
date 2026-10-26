from __future__ import annotations

import os
from pathlib import Path
import pty
import re
import select
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import termios
import time
import unittest

from .common import ROOT, RENDERED_COMPOSE_FIXTURE_ENV
from .release_posture import expanded_release_target


PROCESS = ROOT / "tools/release_process.sh"
LAUNCHER = ROOT / "tools/release_approval_deploy.sh"
CONFIG = ROOT / "tools/release-config.sh"


def make_definition(name: str) -> str:
    source = (ROOT / "Makefile").read_text(encoding="utf-8")
    match = re.search(rf"(?ms)^define {re.escape(name)}\n(.*?)\nendef$", source)
    if match is None:
        raise AssertionError(f"shared Make definition is missing: {name}")
    return match.group(1).replace("$$", "$").replace("\\\n", "")


def make_cleanup() -> str:
    return make_definition("release_snapshot_cleanup")


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
    raise SystemExit(int(os.environ["ATTACH_EXIT"]))
if args[0] == "inspect":
    value = args[2]
    if value == "{{.State.Running}}":
        print("true")
    elif value == "{{.State.Health.Status}}":
        print("healthy")
    elif value == "{{.State.Status}} {{.State.ExitCode}}":
        print(os.environ["FORGE_STATE"])
    elif value == "{{.State.ExitCode}}":
        print(os.environ["GATE_EXIT"])
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
printf '0x%s\n' "$(printf '11%.0s' {1..32})" > "$release_config_dir/deployer-key"
RPC_URL_FILE="$release_config_dir/rpc-url"
DEPLOYER_PRIVATE_KEY_FILE="$release_config_dir/deployer-key"
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
    def test_post_send_artifact_failures_preserve_evidence_and_offer_read_only_recovery(self):
        for failure in ("proxy", "collector"):
            for phase in ("contracts", "ui", "cam"):
                with self.subTest(failure=failure, phase=phase), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    (root / "socket").mkdir()
                    (root / "socket/rpc.sock").touch()
                    (root / "output").mkdir()
                    evidence = root / "output/retained-plan"
                    evidence.write_text("retained evidence")
                    env = self.environment(root, root / "ceremony")
                    env.update(ARTIFACT_FAILURE=failure, CONFIG=str(root / "operator's config.json"), RELEASE_PHASE=phase)
                    script = SHELL_SETUP + r'''
source "$LAUNCHER"
approval_app=bike-nft
release_operation="$RELEASE_PHASE"
CONTRACT_RELEASE_APP=bike-nft
UI_RELEASE_APP=bike-nft
CAM_RELEASE_APP=bike-nft
CAM_RELEASE_REMAINING_TRANSACTIONS=1
CAM_RELEASE_PREPARED_DIR="$CASE_ROOT/prepared"
release_approval_require_terminal() { :; }
RELEASE_APPROVAL_SOCKET_DIR="$CASE_ROOT/socket"
stty() { :; }
release_approval_show_startup() { :; }
release_approval_service_id() { printf '%s\n' "$1"; }
# The fixture has no network or Docker daemon. Only those external peers are replaced.
docker() {
  if [[ "$1" == attach ]]; then
    while [[ ! -f "$CASE_ROOT/stopped" ]]; do sleep 0.01; done
  elif [[ "$2" == --format ]]; then
    case "$3" in
      '{{.State.Health.Status}}') printf 'healthy\n' ;;
      '{{.State.Status}} {{.State.ExitCode}}') printf 'exited 0\n' ;;
      '{{.State.ExitCode}}') printf '0\n' ;;
      *) return 91 ;;
    esac
  else return 92; fi
}
compose_release() {
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  if [[ "$1" == stop ]]; then touch "$CASE_ROOT/stopped"; fi
  if [[ "$1 $2" == 'up -d' && "${@: -1}" == release-artifact-rpc-proxy && "$ARTIFACT_FAILURE" == proxy ]]; then
    printf 'fixture proxy failure\n' >&2; return 7
  fi
  if [[ "$1" == run && "${@: -1}" == release-artifact ]]; then
    printf 'fixture collector failure\n' >&2; return 8
  fi
}
# A Unix socket marks approval readiness; no traffic passes through it.
"$PYTHON" -c 'import os,socket; from pathlib import Path; p=Path(os.environ["CASE_ROOT"])/"socket/rpc.sock"; p.unlink(); s=socket.socket(socket.AF_UNIX); s.bind(str(p))'
release_approval_run "$CASE_ROOT/output"
'''
                    process = self.launch(script, env)
                    stdout, stderr = process.communicate(timeout=10)
                    self.assertNotEqual(0, process.returncode, stdout + stderr)
                    self.assertIn("No transaction was sent by verification", stderr)
                    if phase != "cam":
                        self.assertIn("Do not repeat deployment", stderr)
                    diagnostics = "".join(path.read_text() for path in (root / "output").glob("*-verification-*/verification.log"))
                    self.assertIn("fixture " + failure + " failure", diagnostics)
                    self.assertEqual("retained evidence", evidence.read_text())
                    events = (root / "events").read_text().splitlines()
                    self.assertEqual(1, sum(event.startswith("up ") and event.endswith(" deploy-release") for event in events))
                    self.assertEqual(0 if failure == "proxy" else 1, sum(event.endswith(" release-artifact") for event in events))
                    command = next(line.strip() for line in stderr.splitlines() if "make " in line)
                    command = command[command.index("make "):]
                    expected = ["make", f"bike-nft/release/{phase}/artifact"]
                    if phase == "cam":
                        expected += ["CONFIG=" + env["CONFIG"], "CAM_RECORDS=" + str(root / "output"),
                                     "CAM_BUNDLE=" + str(root / "prepared")]
                    else:
                        expected += [("CONTRACT_RECORDS=" if phase == "contracts" else "UI_RECORDS=") + str(root / "output"),
                                     "CONFIG=" + env["CONFIG"]]
                    self.assertEqual(expected, shlex.split(command))

    def test_artifact_completion_copies_prepared_dependencies_and_rejects_unsafe_paths_first(self):
        for case in ("default", "prepared", "missing", "symlink"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                checkout = root / "checkout"
                current = checkout / "js/node_modules"
                prepared = root / "prepared tree/node_modules"
                selected = current if case == "default" else prepared
                selected.mkdir(parents=True)
                (selected / "identity").write_text(case)
                (selected / "typescript/bin").mkdir(parents=True)
                (selected / "typescript/bin/tsc").write_text("fixture tool")
                (selected / ".bin").mkdir()
                (selected / ".bin/tsc").symlink_to("../typescript/bin/tsc")
                original = (selected / "identity").read_bytes()
                supplied = selected
                if case == "missing":
                    supplied = root / "missing/node_modules"
                elif case == "symlink":
                    (root / "alias").symlink_to(prepared.parent, target_is_directory=True)
                    supplied = root / "alias/node_modules"
                records = root / "records"
                for child in ("plan", "broadcast", "artifact"):
                    (records / child).mkdir(parents=True, exist_ok=True)
                (records / "plan/release-plan.json").write_text("{}")
                checkout.mkdir(exist_ok=True)
                env = self.environment(root, root)
                env.update(CONFIG=str(root / "config.json"), PRIVATE_KEY="must-not-reach-compose", RPC_URL="must-not-reach-compose")
                (root / "config.json").write_text("{}")
                prelude = root / "prelude.sh"
                prelude.write_text(make_definition("release_host_guard_functions") + r'''
# Alpine checks lack GNU realpath -m and mktemp's suffix template support.
realpath() { "$PYTHON" -c 'import os,sys; print(os.path.abspath(sys.argv[-1]))' "$@"; }
mktemp() { "$PYTHON" -c 'import os,sys,tempfile; print(tempfile.mkdtemp(dir=os.path.dirname(sys.argv[-1])))' "$@"; }
git() { printf '%040d\n' 2; }
load_release_config() {
  printf 'config\n' >> "$CASE_ROOT/events"
  release_config_dir="$CASE_ROOT/config-stage"
  mkdir "$release_config_dir"
  CONTRACT_RELEASE_APP=escrow
  RPC_URL_FILE="$CASE_ROOT/rpc-url"
  RELEASE_REHEARSAL=0
}
compose_release_config() {
  printf 'plan\n' >> "$CASE_ROOT/events"
  printf '%040s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa > "$release_config_dir/contract-source"
}
release_run_owned() {
  shift
  if [[ "$1 $2" == 'bash tools/release_tool_images.sh' ]]; then
    printf 'images:%s:%s\n' "$5" "$6" >> "$CASE_ROOT/events"
  else "$@"; fi
}
''')
                compose = root / "compose.sh"
                compose.write_text(r'''
printf "%s\n" "$*" >> "$CASE_ROOT/events"
printf "%s\n" "${PRIVATE_KEY-unset}" "${RPC_URL-unset}" "$RPC_URL_FILE" "$RELEASE_OUTPUT_DIR" "$RELEASE_SOURCE_DIR" > "$CASE_ROOT/grants"
''')
                arguments = [
                    "make", "--no-print-directory", "-f", str(ROOT / "Makefile"), "escrow/release/contracts/artifact", f"CONTRACT_RECORDS={records}",
                    f"CURDIR={checkout}", "LANE_GUARD=:", "SOLDEER_DEPS_GUARD=:", "PACKAGE_DEPS_GUARD=exit 97",
                    f"release_host_guard_functions=source {prelude}", "release_config_compose=:",
                    'release_snapshot_allocate=ceremony_root="$$CASE_ROOT/ceremony"; ceremony_source="$$ceremony_root/source"; ceremony_project=fixture; mkdir -p "$$ceremony_source/js"; printf "allocate\\n" >> "$$CASE_ROOT/events"',
                    'release_snapshot_archive=mkdir -p "$$ceremony_source/tools" "$$ceremony_source/dapps"; cp "$$LAUNCHER" "$$(dirname -- "$$LAUNCHER")/release_approval_preflight.sh" "$$ceremony_source/tools/"; cp() { if [[ "$${3-}" == dapps/dependencies ]]; then mkdir -p "$$4"; else command cp "$$@"; fi; }', "release_snapshot_cleanup=:",
                    'release_snapshot_dependency_compose=compose_release_dependencies() { printf "dependencies\\n" >> "$$CASE_ROOT/events"; }',
                    f"DOCKER_COMPOSE=bash {compose}",
                ]
                if case != "default":
                    arguments.append(f"RELEASE_ARTIFACT_NODE_MODULES_DIR={supplied}")
                result = subprocess.run(arguments, cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
                if case in ("missing", "symlink"):
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("RELEASE_ARTIFACT_NODE_MODULES_DIR", result.stderr)
                    if case == "symlink":
                        self.assertIn("must not pass through a symlink", result.stderr)
                    self.assertEqual(["config", "plan"], (root / "events").read_text().splitlines())
                    self.assertFalse((root / "ceremony").exists())
                    continue
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                copied = root / "ceremony/source/js/node_modules"
                self.assertEqual(original, (copied / "identity").read_bytes())
                self.assertEqual(original, (selected / "identity").read_bytes())
                self.assertEqual("../typescript/bin/tsc", os.readlink(copied / ".bin/tsc"))
                events = (root / "events").read_text().splitlines()
                self.assertIn("images:" + "a" * 40 + ":" + "2".zfill(40), events)
                self.assertEqual(["unset", "unset", str(root / "rpc-url"), str(records), str(root / "ceremony/source")], (root / "grants").read_text().splitlines())
                commands = [event for event in events if " -f " in " " + event]
                self.assertIn("release-artifact-dependencies", commands[0])
                self.assertIn("release-artifact-rpc-proxy", commands[1])
                if case == "prepared":
                    self.assertFalse(current.exists())

    def test_deployment_preserves_app_settings_and_explicit_file_grants(self):
        samples = {
            "bike-nft": '{"baseTokenURI":"","componentsPauser":"0x1111111111111111111111111111111111111111"}',
            "escrow": '{}',
            "pay-to-play": '{"intendedPaymentAdmin":"0x1111111111111111111111111111111111111111","nullClaimPeriod":90}',
        }
        for app, settings in samples.items():
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env = self.environment(root, root)
                env.update(CONFIG=str(root / "config.json"),
                           CONTRACT_RELEASE_EXPECTED_CHAIN_ID="43113", CONTRACT_RELEASE_OUTPUT_DIR=str(root / "new-output"),
                           CONTRACT_RELEASE_SETTINGS_JSON=settings,
                           RPC_URL_FILE=str(root / "rpc-url"), DEPLOYER_PRIVATE_KEY_FILE=str(root / "key"),
                           PRIVATE_KEY="must-not-reach-compose", RPC_URL="must-not-reach-compose")
                stub = root / "compose.sh"
                stub.write_text(r'''
printf '%s\n' "$@" > "$CASE_ROOT/arguments"
printf '%s\n' "${PRIVATE_KEY-unset}" "${RPC_URL-unset}" "$RPC_URL_FILE" "$DEPLOYER_PRIVATE_KEY_FILE" "$RELEASE_OUTPUT_DIR" "$RELEASE_SOURCE_DIR" > "$CASE_ROOT/grants"
printf '%s' "$CONTRACT_RELEASE_SETTINGS_JSON" > "$CASE_ROOT/settings"
''', encoding="utf-8")
                generated = expanded_release_target(f"{app}/release/contracts/deploy", (
                    "LANE_GUARD=:", "SOLDEER_DEPS_GUARD=:", "PACKAGE_DEPS_GUARD=:",
                    "release_require_clean_source=source_commit=" + "ab" * 20,
                    "release_host_guard_functions=:", "release_config_compose=:",
                    "release_deploy_execution=compose_release run --rm --no-deps release-plan",
                    f"DOCKER_COMPOSE=bash {stub}",
                ))
                script = r'''
ceremony_project=fixture
ceremony_source="$CASE_ROOT/archived-source"
release_command_grace=15
release_phase_overlays=(-f "$ceremony_source/compose/release/reference.yml")
release_transport_args=()
release_image_args=(-f "$CASE_ROOT/images-deploy.yml")
export -n RPC_URL_FILE DEPLOYER_PRIVATE_KEY_FILE
load_release_config() { printf '%s\n' "$*" > "$CASE_ROOT/config-mode"; }
require_release_rpc_input() { [[ -n "$RPC_URL_FILE" ]]; }
require_protected_release_file() { [[ "$1" == "$DEPLOYER_PRIVATE_KEY_FILE" ]]; }
validate_new_release_output() { [[ ! -e "$1" ]]; }
release_run_owned() { shift; "$@"; }
''' + generated
                process = self.launch(script, env)
                stdout, stderr = process.communicate(timeout=5)
                self.assertEqual(0, process.returncode, stdout + stderr)
                self.assertEqual(f"{app} contracts-deploy \n", (root / "config-mode").read_text())
                self.assertEqual(["unset", "unset", str(root / "rpc-url"), str(root / "key"), str(root / "new-output"), str(root / "archived-source")], (root / "grants").read_text().splitlines())
                self.assertEqual(settings, (root / "settings").read_text())
                self.assertEqual([
                    "-f", str(root / "archived-source/compose/release/deploy.yml"),
                    "-f", str(root / "archived-source/compose/release/artifact.yml"),
                    "-f", str(root / "archived-source/compose/release/contracts-artifact.yml"),
                    "-f", str(root / "archived-source/compose/release/contracts.yml"),
                    "-f", str(root / "archived-source/compose/release/reference.yml"),
                    "-f", str(root / "images-deploy.yml"), "run", "--rm", "--no-deps", "release-plan",
                ], (root / "arguments").read_text().splitlines())

    def test_public_verification_composes_keyless_phase_artifact_completion(self):
        for app in ("bike-nft", "escrow", "pay-to-play"):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                records = root / "records"
                for phase in ("contracts", "ui", "cam"):
                    (records / phase / "artifact").mkdir(parents=True)
                records.chmod(0o700)
                (records / "cam/artifact/cam-publication.json").write_text("{}")
                env = self.environment(root, root)
                env.update(CONFIG=str(root / "readonly.json"), CAM_RELEASE_OUTPUT_DIR=str(records))
                generated = expanded_release_target(f"{app}/release/verify", (
                    "LANE_GUARD=:", "SOLDEER_DEPS_GUARD=:", "PACKAGE_DEPS_GUARD=:",
                    "release_require_clean_source=:", "release_host_guard_functions=:", "release_config_compose=:",
                ))
                script = r'''
load_release_config() { printf '%s\n' "$*" > "$CASE_ROOT/config-mode"; }
require_release_config() { :; }
require_release_file() { [[ -f "$1" ]]; }
reject_release_path_symlinks() { [[ ! -L "$1" ]]; }
release_run_owned() {
  shift
  printf '%s\0' "$@" >> "$CASE_ROOT/calls"
  printf '\0' >> "$CASE_ROOT/calls"
}
release_make_cleanup_grace=420
''' + generated
                process = self.launch(script, env)
                stdout, stderr = process.communicate(timeout=5)
                self.assertEqual(0, process.returncode, stdout + stderr)
                self.assertEqual(f"{app} cam-bundle \n", (root / "config-mode").read_text())
                calls = [call.split("\0") for call in (root / "calls").read_text().rstrip("\0").split("\0\0")]
                expected = []
                for phase, name in (("contracts", "CONTRACT_RECORDS"), ("ui", "UI_RECORDS"), ("cam", "CAM_RECORDS")):
                    command = ["make", "--no-print-directory", f"{app}/release/{phase}/artifact",
                               "CONFIG=" + env["CONFIG"], f"{name}={records / phase}"]
                    if phase == "cam":
                        command.append(f"CAM_BUNDLE={records / 'cam-bundle'}")
                    expected.append(command)
                self.assertEqual(expected, calls)
                self.assertIn("Verified CAM publication", stdout)

    def test_public_viewer_inspection_failure_never_starts_or_cleans_a_project(self):
        for inspection in ("failed", "occupied", "setup-failed", "empty"):
            with self.subTest(inspection=inspection), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                artifact = root / "deployment.json"
                artifact.write_text("{}", encoding="utf-8")
                env = self.environment(root, root)
                env.update(APP="bike-nft", DEPLOYMENT_ARTIFACT_FILE=str(artifact),
                           RESOURCE_ORIGIN="https://raw.githubusercontent.com", PUBLIC_RPC_URL="https://rpc.example.test",
                           RELEASE_VIEWER_PORT="5174", INSPECTION=inspection)
                generated = subprocess.run(
                    ["make", "--no-print-directory", "--dry-run", "-f", str(ROOT / "Makefile"),
                     "viewer/release/up", "LANE_GUARD=:", "PACKAGE_DEPS_GUARD=:", "DOCKER_COMPOSE=docker compose"],
                    cwd=ROOT, env=env, capture_output=True, text=True, check=True,
                )
                script = r'''
docker() {
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  if [[ " $* " == *" ps --all --quiet "* ]]; then
    if [[ "$INSPECTION" == failed ]]; then printf 'inspection unavailable\n' >&2; return 37; fi
    if [[ "$INSPECTION" == occupied ]]; then printf 'existing-container\n'; fi
  elif [[ " $* " == *" viewer-url "* ]]; then
    if [[ "$INSPECTION" == setup-failed ]]; then printf 'Viewer setup input ended.\n' >&2; return 38; fi
    printf 'bike-nft\nhttps://raw.githubusercontent.com\nhttps://rpc.example.test/\nhttp://127.0.0.1:5174/\n'
  fi
}
''' + generated.stdout
                process = self.launch(script, env)
                stdout, stderr = process.communicate(timeout=10)
                events = (root / "events").read_text(encoding="utf-8").splitlines()
                if inspection == "empty":
                    self.assertEqual(0, process.returncode, stdout + stderr)
                    self.assertTrue(any(" up --build " in f" {event} " for event in events))
                    self.assertTrue(any(" down --timeout " in f" {event} " for event in events))
                else:
                    self.assertEqual({"failed": 37, "occupied": 2, "setup-failed": 38}[inspection], process.returncode, stdout + stderr)
                    self.assertEqual(2 if inspection == "setup-failed" else 1, len(events), events)
                    self.assertFalse(any(" up --build " in f" {event} " or " down --timeout " in f" {event} " for event in events))

    def test_demo_viewer_captures_use_plain_compose_output(self):
        for app in ("bike-nft", "escrow", "pay-to-play"):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stub = root / "compose.sh"
                stub.write_text(r'''
docker() {
if [[ "$1" != compose ]]; then
  [[ "$2" == ls ]]
  return
fi
shift
printf '%s\n' "$*" >> "$CASE_ROOT/events"
if [[ "${COMPOSE_PROGRESS-}" != plain || "${COMPOSE_ANSI-}" != never ]]; then
  printf 'Compose attempted console progress during an operator workflow\n' >&2
  exit 39
fi
if [[ "${@: -1}" == *-viewer-url ]]; then
  printf 'http://127.0.0.1:5173/?fixture=demo\n'
fi
}
env() {
  if [[ "$1 $2 $3" == '-u PRIVATE_KEY docker' ]]; then
    shift 3
    docker "$@"
  else
    command env "$@"
  fi
}
export -f docker env
''')
                overrides = root / "overrides.mk"
                overrides.write_text("dapps/deps/verify: ; @:\n")
                env = self.environment(root, root)
                env["BASH_ENV"] = str(stub)
                env.pop("COMPOSE_PROGRESS", None)
                env.pop("COMPOSE_ANSI", None)
                result = subprocess.run(
                    ["make", "--no-print-directory", "-f", str(ROOT / "Makefile"), "-f", str(overrides),
                     f"{app}/local/demo/gui/up", "LANE_GUARD=:", "PACKAGE_DEPS_GUARD=:",
                     "DOCKER_COMPOSE=docker compose"],
                    cwd=ROOT, env=env, capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertIn("http://127.0.0.1:5173/?fixture=demo", result.stdout)
                events = (root / "events").read_text().splitlines()
                self.assertEqual(1, sum(event.endswith(f"{app}-viewer-url") for event in events))
                self.assertTrue(any("--abort-on-container-exit" in event for event in events))

    def test_local_viewer_uses_shared_capture_without_accepting_a_public_rpc_override(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            artifact = root / "deployment.json"
            artifact.write_text("{}")
            env = self.environment(root, root)
            env.update(APP="bike-nft", DEPLOYMENT_ARTIFACT_FILE=str(artifact),
                       RESOURCE_ORIGIN="https://raw.githubusercontent.com", PUBLIC_RPC_URL="https://wrong-chain.example.test",
                       RELEASE_VIEWER_PORT="5174")
            generated = expanded_release_target("network/local/viewer/up", ("LANE_GUARD=:", "PACKAGE_DEPS_GUARD=:"))
            script = r'''
docker() {
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  if [[ "$1 $2" == 'network inspect' ]]; then printf 'true\n'
  elif [[ " $* " == *" ps --quiet --status running "* ]]; then printf 'fixture-chain\n'
  elif [[ " $* " == *" viewer-url "* ]]; then
    printf 'rpc:%s\n' "$RELEASE_VIEWER_RPC_URL" >> "$CASE_ROOT/events"
    printf 'bike-nft\nhttps://raw.githubusercontent.com\nhttp://127.0.0.1:5174/rpc\nhttp://127.0.0.1:5174/?chainId=eip155%%3A31338\n'
  fi
}
''' + generated
            process = self.launch(script, env)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(0, process.returncode, stdout + stderr)
            events = (root / "events").read_text().splitlines()
            self.assertIn("rpc:http://127.0.0.1:5174/rpc", events)
            self.assertIn("chainId=eip155%3A31338", stdout)
            self.assertNotIn("wrong-chain.example.test", stdout + stderr + "\n".join(events))
            self.assertTrue(any(" up --build " in f" {event} " for event in events))
            self.assertTrue(any(" down --timeout " in f" {event} " for event in events))

    def test_retained_signer_log_redacts_configured_credentials_and_keeps_public_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "output").mkdir()
            (root / "source").mkdir()
            key = "0x" + "ab" * 32
            token = "opaque-[credential]+token"
            query = "query-credential-key"
            endpoint = f"https://rpc.example.test/{token}/ext/bc/C/rpc?api_key={query}"
            (root / "rpc-url").write_text(endpoint + "\n")
            (root / "key").write_text(key + "\n")
            env = self.environment(root, root)
            env.update(RPC_URL_FILE=str(root / "rpc-url"), DEPLOYER_PRIVATE_KEY_FILE=str(root / "key"))
            script = r'''
source "$LAUNCHER"
compose_release() {
  printf 'HTTP 503; chain 43113; owner 0x1234; endpoint %s; path %s; query %s; key %s; uppercase %s\n' \
    "$(cat "$RPC_URL_FILE")" 'opaque-[credential]+token' 'query-credential-key' "$(cat "$DEPLOYER_PRIVATE_KEY_FILE")" "$(tr 'a-f' 'A-F' < "$DEPLOYER_PRIVATE_KEY_FILE" | cut -c3-)"
}
release_approval_retain_signer_log "$CASE_ROOT/output"
'''
            process = self.launch(script, env)
            stdout, stderr = process.communicate(timeout=10)
            self.assertEqual(0, process.returncode, stdout + stderr)
            text = (root / "output/deploy.log").read_text()
            for secret in (endpoint, token, query, key, key[2:].upper()):
                self.assertNotIn(secret, text)
            for public in ("HTTP 503", "chain 43113", "owner 0x1234"):
                self.assertIn(public, text)

    def test_setup_probe_finishes_teardown_before_key_entry_and_aborts_on_failure(self):
        for fault in ("", "up", "read", "down"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env = self.environment(root, root)
                env.update(CONFIG=str(root / "release.json"), PROBE_FAULT=fault)
                script = SHELL_SETUP + r'''
source "$CONFIG_SOURCE"
release_config_dir="$CASE_ROOT/config"
release_run_owned() { printf 'tools\n' >> "$CASE_ROOT/events"; }
compose_release_setup_rpc() {
  case "$1" in
    up) printf 'up\n' >> "$CASE_ROOT/events"; [[ "$PROBE_FAULT" != up ]] ;;
    run) printf 'read\n' >> "$CASE_ROOT/events"; if [[ "$PROBE_FAULT" == read ]]; then printf 'RPC eth_chainId failed: HTTP 503.\n' >&2; return 1; fi; printf '43113\n' ;;
    down) printf 'down\n' >> "$CASE_ROOT/events"; [[ "$PROBE_FAULT" != down ]] ;;
    logs) printf 'rpc-proxy: safe failure category\n' ;;
    *) return 91 ;;
  esac
}
trap 'release_config_teardown' EXIT
release_config_probe_chain "$CASE_ROOT" aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
printf 'key\n' >> "$CASE_ROOT/events"
'''
                process = self.launch(script, env)
                stdout, stderr = process.communicate(timeout=10)
                events = (root / "events").read_text().splitlines()
                if fault:
                    self.assertNotEqual(0, process.returncode, stdout + stderr)
                    self.assertNotIn("key", events)
                    logs = list(root.glob("release.json.setup-rpc-*"))
                    self.assertEqual(1, len(logs))
                    self.assertEqual(0o600, logs[0].stat().st_mode & 0o777)
                    if fault == "read":
                        self.assertIn("RPC eth_chainId failed: HTTP 503", stderr)
                else:
                    self.assertEqual(0, process.returncode, stdout + stderr)
                    self.assertEqual(["tools", "up", "read", "down", "key"], events)
                    self.assertEqual("43113\n", (root / "config/chain-id").read_text())

    def test_repeated_short_credentials_do_not_recursively_expand_log_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            endpoint = "https://rpc.example.test/path?" + "&".join(["key=e"] * 12)
            (root / "rpc-url").write_text(endpoint + "\n")
            (root / "key").write_text("0x" + "ab" * 32 + "\n")
            env = self.environment(root, root)
            env.update(RPC_URL_FILE=str(root / "rpc-url"), DEPLOYER_PRIVATE_KEY_FILE=str(root / "key"))
            script = r'''
source "$LAUNCHER"
printf 'HTTP 503; chain 43113; owner 0xdead; eeeeeeeeeeeeeeeeeeee\n' | release_approval_redact_log
'''
            process = self.launch(script, env)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(0, process.returncode, stderr)
            self.assertLess(len(stdout), 400)
            self.assertIn("HTTP 503; chain 43113", stdout)
            self.assertIn("0xd[redacted]ad", stdout)
            self.assertNotIn("0xdad", stdout)

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
            "FORGE_STATE": "running 0",
            "GATE_EXIT": "0",
            "ATTACH_EXIT": "0",
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

    def test_attachment_cancellation_and_completed_rejection_restore_terminal_and_remove_resources(self) -> None:
        for phase in ("start", "review", "completed-rejection", "presentation"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(
                prefix=f"cam-release-{os.getuid()}-", dir="/tmp",
            ) as ceremony_directory:
                root, ceremony = Path(directory), Path(ceremony_directory)
                (root / "socket").mkdir()
                (root / "output").mkdir()
                (root / "fake_docker.py").write_text(FAKE_DOCKER, encoding="utf-8")
                env = self.environment(root, ceremony)
                env["ATTACH_PHASE"] = phase
                if phase == "presentation":
                    env["ATTACH_PHASE"] = "review"
                if phase == "completed-rejection":
                    env["ATTACH_PHASE"] = "review"
                    env["FORGE_STATE"] = "exited 1"
                    env["GATE_EXIT"] = "143"
                    env["ATTACH_EXIT"] = "143"
                script = SHELL_SETUP + "\n" + r"""
source "$LAUNCHER"
release_operation=contracts
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
      if [[ "$service" == deploy-release ]]; then
        printf 'Signer starting\nSigner started\n'
        touch "$CASE_ROOT/signer"
      fi
      ;;
    ps) printf '%064d\n' 1 ;;
    stop) printf 'Stopping approval fixture\n' >&2; touch "$CASE_ROOT/stopped" ;;
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
                if phase == "presentation":
                    script = 'exec 1>&0 2>&0\n' + script
                master, slave = pty.openpty()
                original_terminal = termios.tcgetattr(slave)
                process = self.launch(script, env, stdin=slave)
                try:
                    self.wait_path(root / "attached", process)
                    if phase in ("review", "completed-rejection", "presentation"):
                        self.wait_path(root / "signer", process)
                    if phase == "presentation":
                        captured = bytearray()
                        deadline = time.monotonic() + 2
                        while b"Signer started" not in captured and time.monotonic() < deadline:
                            if select.select([master], [], [], 0.1)[0]:
                                captured.extend(os.read(master, 8192))
                        self.assertIn(b"Signer starting\r\nSigner started\r\n", captured)
                    # Docker's raw attachment receives byte 0x03; this does not
                    # send SIGINT to the host launcher.
                    if phase != "completed-rejection":
                        os.write(master, b"\x03")
                    stdout, stderr = process.communicate(timeout=10)
                    if phase == "presentation":
                        while select.select([master], [], [], 0)[0]:
                            captured.extend(os.read(master, 8192))
                        stderr = captured.decode("utf-8", errors="replace")
                    self.assertEqual(original_terminal, termios.tcgetattr(slave))
                finally:
                    self.emergency_cleanup(process, root)
                    os.close(master)
                    os.close(slave)
                self.assertEqual(1, process.returncode, stdout + stderr)
                events = (root / "events").read_text().splitlines()
                self.assertEqual(1, events.count("up:release-approval"))
                expected_signers = 0
                if phase in ("review", "completed-rejection", "presentation"):
                    expected_signers = 1
                self.assertEqual(expected_signers, events.count("up:deploy-release"))
                self.assertEqual(
                    ["down:run", "down:check", "down:dependencies", "down:rpc", "down:config"],
                    [event for event in events if event.startswith("down:")],
                )
                self.assertFalse(ceremony.exists())
                self.assertTrue((root / "attachment-ended").exists())
                expected_exit = "unknown\n"
                if phase == "completed-rejection":
                    expected_exit = "1\n"
                self.assertEqual(expected_exit, (root / "output/forge-exit-code").read_text())
                self.assertIn("fixture Forge output", (root / "output/deploy.log").read_text())
                self.assertIn("Review broadcast and approval audit for possible earlier effects.", stderr)
                if phase == "completed-rejection":
                    self.assertLess(stderr.index("Deployment signer failed"), stderr.index("Stopping approval fixture"))
                    self.assertIn(str(root / "output/deploy.log"), stderr)
                    self.assertEqual(0o600, (root / "output/deploy.log").stat().st_mode & 0o777)

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

    def test_config_one_shot_success_skips_down_but_failed_or_interrupted_runs_reconcile(self) -> None:
        definition = make_definition("release_config_compose")
        for name, value in {
            "LOCAL_UID": '"$LOCAL_UID"', "LOCAL_GID": '"$LOCAL_UID"',
            "LOCAL_RELEASE_NETWORK": "fixture-local", "COMPOSE_DIR": "compose",
            "DOCKER_COMPOSE": '"$PYTHON" "$CASE_ROOT/compose.py"',
        }.items():
            definition = definition.replace(f"$({name})", value)
        for outcome, fail_down in (("0", ""), ("23", ""), ("23", "config"), ("interrupt", ""), ("interrupt", "config")):
            with self.subTest(outcome=outcome, fail_down=fail_down), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "worker.py").write_text(WORKER)
                (root / "compose.py").write_text('''
import os
from pathlib import Path
import sys
root = Path(os.environ["CASE_ROOT"])
operation = sys.argv[3]
with (root / "events").open("a") as stream:
    stream.write(operation + "\\n")
if operation == "run":
    if os.environ["RUN_OUTCOME"] == "interrupt":
        exec((root / "worker.py").read_text())
    raise SystemExit(int(os.environ["RUN_OUTCOME"]))
if operation == "down":
    raise SystemExit(int(os.environ["FAIL_DOWN"] == "config"))
raise SystemExit(91)
''')
                env = self.environment(root, root)
                env.update(RUN_OUTCOME=outcome, FAIL_DOWN=fail_down)
                script = '''
source "$PROCESS"
release_process_init
release_command_grace=2
source "$CONFIG_SOURCE"
CONFIG="$CASE_ROOT/operator.json"
release_config_stage "$CASE_ROOT"
printf '%s\\n' "$release_config_dir" > "$CASE_ROOT/stage"
printf 'fixture input\\n' > "$release_config_dir/rpc-url"
''' + definition + '\ncompose_release_config run --rm --no-deps -T release-config deploy escrow fixture-source\n'
                process = self.launch(script, env)
                try:
                    if outcome == "interrupt":
                        self.wait_path(root / "ready", process)
                        process.send_signal(signal.SIGTERM)
                    stdout, stderr = process.communicate(timeout=10)
                finally:
                    self.emergency_cleanup(process, root)
                stage = Path((root / "stage").read_text().strip())
                expected = 0
                if fail_down:
                    expected = 2
                elif outcome == "interrupt":
                    expected = 143
                elif outcome != "0":
                    expected = int(outcome)
                self.assertEqual(expected, process.returncode, stdout + stderr)
                events = (root / "events").read_text().splitlines()
                self.assertEqual("run", events[0])
                self.assertEqual(outcome != "0", "down" in events)
                self.assertEqual(bool(fail_down), stage.exists())
                if fail_down:
                    self.assertIn("Release configuration teardown failed", stderr)
                    self.assertIn("retained mounted inputs", stderr)

    def test_config_update_is_interactive_and_published_only_after_host_admission(self) -> None:
        for outcome in ("update", "cancel", "bad-image", "bad-output", "changed", "noninteractive", "verify", "ui-override"):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                config = root / "config.json"
                config.write_text("original")
                config.chmod(0o600)
                (root / "old-output").mkdir()
                env = self.environment(root, root)
                env.update(CONFIG=str(config), OUTCOME=outcome)
                script = f'source {shlex.quote(str(CONFIG))}\n' + r'''
source_commit=current
require_release_config() { [[ -f "$1" ]]; }
release_config_stage() { [[ "$1" == "$CASE_ROOT" ]]; release_config_dir="$1/stage"; mkdir "$release_config_dir"; }
release_config_prepare_approval_images() { :; }
validate_new_release_output() { [[ "$OUTCOME" != bad-output && "$1" == "$CASE_ROOT/new-output" ]]; }
docker() { [[ "$OUTCOME" != bad-image ]] || return 1; printf '%s\n' "$5"; }
compose_release_config() {
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  if [[ " $* " == *" release-config update "* || " $* " == *" release-config update-ui "* ]]; then
    [[ "$OUTCOME" != cancel ]] || return 2
    printf updated > "$release_config_dir/release.json"
    if [[ "$OUTCOME" == changed ]]; then printf concurrent-edit > "$CONFIG"; fi
  elif [[ -v release_config_input ]]; then
    if [[ "$OUTCOME" == ui-override ]]; then
      printf 'RELEASE_APPROVAL_IMAGE=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0UI_RELEASE_OUTPUT_DIR=%s/old-output\0' "$CASE_ROOT" > "$release_config_dir/inputs"
    else
      printf 'RELEASE_APPROVAL_IMAGE=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0ESCROW_RELEASE_OUTPUT_DIR=%s/new-output\0' "$CASE_ROOT" > "$release_config_dir/inputs"
    fi
  else return 3; fi
}
mode=deploy
if [[ "$OUTCOME" == verify ]]; then mode=verify; fi
if [[ "$OUTCOME" == ui-override ]]; then
  OUTPUT_DIR="$CASE_ROOT/new-output"
  load_release_config escrow ui-deploy
  [[ "$UI_RELEASE_OUTPUT_DIR" == "$CASE_ROOT/new-output" ]]
else load_release_config escrow "$mode"; fi
'''
                master, slave = pty.openpty()
                try:
                    interactive = outcome != "noninteractive"
                    process = subprocess.Popen(
                        [self.bash, "-eu", "-o", "pipefail", "-c", script],
                        cwd=ROOT, env=env, stdin=slave if interactive else subprocess.DEVNULL,
                        stdout=slave, stderr=slave,
                    )
                    process.wait(timeout=10)
                    self.assertEqual(outcome in ("update", "ui-override"), process.returncode == 0)
                    expected = "updated" if outcome in ("update", "ui-override") else "concurrent-edit" if outcome == "changed" else "original"
                    self.assertEqual(expected, config.read_text())
                    events = (root / "events").read_text()
                    self.assertEqual(outcome not in ("verify", "noninteractive"), "release-config update" in events)
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait(timeout=4)
                    os.close(master)
                    os.close(slave)

    def test_setup_completion_follows_link_and_prints_safe_next_commands_for_every_app(self) -> None:
        for app in ("bike-nft", "escrow", "pay-to-play"):
            for fail_link in (False, True):
                with self.subTest(app=app, fail_link=fail_link), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    env = self.environment(root, root)
                    env.update(APP=app, PREFIX=app.upper().replace("-", "_"), CONFIG=str(root / "operator's release.json"), RELEASE_APPROVAL_IMAGE="must-not-print-this-image")
                    guards = '''
git() { [[ "$*" == "rev-parse HEAD" ]] || return 91; printf '%s\\n' 0123456789abcdef0123456789abcdef01234567; }
validate_new_release_output() { [[ ! -e "$1" ]]; }
recheck_new_release_output() { [[ ! -e "$1" ]]; }
require_release_config() { [[ -f "$1" ]]; }
release_config_stage() { release_config_dir="$CASE_ROOT/stage"; mkdir "$release_config_dir"; }
'''
                    composition = '''
release_config_prepare_approval_images() { :; }
docker() { [[ "$1 $2 $3" == 'image inspect --format' && "$4" == '{{.Id}}' ]]; printf '%s\n' "$5"; }
compose_release_config() {
  if [[ " $* " == *" release-setup network "* ]]; then
    printf 'public\n' > "$release_config_dir/setup-network"
  elif [[ " $* " == *" release-setup "* ]]; then
    printf '{}' > "$release_config_dir/release.json"
  else
    printf 'RELEASE_REHEARSAL=0\\0RELEASE_APPROVAL_IMAGE=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\0%s_RELEASE_OUTPUT_DIR=%s/deployment\\0' "$PREFIX" "$CASE_ROOT" > "$release_config_dir/inputs"
  fi
}
'''
                    script = make_definition("release_setup")
                    for old, new in {
                        "$(LANE_GUARD)": ":", "$(patsubst %/release/setup,%,$@)": app,
                        "$(release_host_guard_functions)": guards.strip(), "$(release_config_compose)": composition.strip(),
                        "$(release_setup_rpc_compose)": "release_config_probe_chain() { :; }", "$(CURDIR)": str(ROOT),
                    }.items():
                        script = script.replace(old, new)
                    if fail_link:
                        script = 'ln() { return 17; }\n' + script
                    process = self.launch(script, env)
                    stdout, stderr = process.communicate(timeout=10)
                    if fail_link:
                        self.assertEqual(17, process.returncode, stdout + stderr)
                        self.assertNotIn("Saved release configuration:", stdout)
                        self.assertNotIn("make ", stdout)
                        self.assertFalse(Path(env["CONFIG"]).exists())
                        continue
                    self.assertEqual(0, process.returncode, stdout + stderr)
                    self.assertTrue(Path(env["CONFIG"]).is_file())
                    self.assertIn("Saved release configuration:", stdout)
                    self.assertIn("No transactions", stdout)
                    self.assertIn("source commit", stdout)
                    self.assertIn("make " + app + "/release/deploy", stdout)
                    self.assertNotIn('RELEASE_APPROVAL_IMAGE=', stdout)
                    self.assertIn("make " + app + "/release/verify", stdout)
                    self.assertNotIn(env["RELEASE_APPROVAL_IMAGE"], stdout)
                    if app == "pay-to-play":
                        self.assertIn("payment admin", stdout)
                    commands = [shlex.split(line) for line in stdout.splitlines() if line.startswith("  make ")]
                    self.assertEqual([
                        ["make", f"{app}/release/deploy", f"CONFIG={env['CONFIG']}"],
                        ["make", f"{app}/release/verify", f"CONFIG={env['CONFIG']}"],
                    ], commands)

    def test_network_allocation_failure_prevents_approval_and_signer_start(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env = self.environment(root, root)
            script = f'source {shlex.quote(str(LAUNCHER))}\n' + r'''
release_operation=contracts
compose_release() {
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  printf '%s %s\n' "${COMPOSE_PROGRESS-unset}" "${COMPOSE_ANSI-unset}" > "$CASE_ROOT/presentation"
  if [[ " $* " == *" --no-start "* ]]; then return 23; fi
  return 97
}
release_approval_run "$CASE_ROOT/output"
'''
            process = self.launch(script, env)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(23, process.returncode, stdout + stderr)
            self.assertEqual([
                "up --no-start --no-build --no-deps release-rpc-proxy release-artifact-rpc-proxy",
            ], (root / "events").read_text().splitlines())
            self.assertEqual("plain never\n", (root / "presentation").read_text())

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
release_operation=contracts
docker() {
  if [[ "$1" == logs ]]; then
    if [[ "$3" == 16 ]]; then
      case "$STARTUP_CASE" in
        incomplete) printf '%s\n' 'Type start and press Enter to open the approval socket.' ;;
        *) printf '%s\n' 'private startup failure' >&2 ;;
      esac
    else
      printf '%s\n' 'private startup failure' >&2
      case "${@: -1}" in
        *2) printf '%s\n' 'rpc-proxy: request not forwarded: capacity exhausted' ;;
        *3) printf '%s\n' 'rpc-proxy: upstream returned HTTP 503' ;;
      esac
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
    ps)
      case "${@: -1}" in
        release-rpc-proxy) printf '%064d\n' 2 ;;
        release-artifact-rpc-proxy) printf '%064d\n' 3 ;;
        *) printf '%064d\n' 1 ;;
      esac ;;
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
                    self.assertIn("request not forwarded: capacity exhausted", contents)
                    self.assertIn("upstream returned HTTP 503", contents)
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

    def test_cleanup_failures_name_the_owner_and_preserve_inputs_after_remaining_teardown(self) -> None:
        failures = {
            "process": ('release_process_cleanup_begin() { trap - EXIT; trap "" INT TERM HUP; return 1; }', "Owned release process"),
            "approval": ('release_approval_cleanup() { return 1; }', "Approval process or terminal"),
            "config-teardown": ('release_config_teardown() { fake_down config; return 1; }', "Release configuration teardown"),
            "config-files": ('release_config_cleanup() { return 1; }', "Release configuration file cleanup"),
        }
        for phase, (failure, message) in failures.items():
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory(
                prefix=f"cam-release-{os.getuid()}-", dir="/tmp",
            ) as ceremony_directory:
                root, ceremony = Path(directory), Path(ceremony_directory)
                script = SHELL_SETUP + "\n" + failure
                script += "\ncleanup() {\n" + make_cleanup() + "\n}\ntrap cleanup EXIT\nexit 7\n"
                process = self.launch(script, self.environment(root, ceremony))
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(2, process.returncode, stdout + stderr)
                self.assertIn(message, stderr)
                self.assertTrue(ceremony.is_dir())
                self.assertTrue((root / "config/rpc-url").is_file())
                events = (root / "events").read_text().splitlines()
                self.assertEqual(5, sum(event.startswith("down:") for event in events))

    def test_cleanup_callbacks_report_their_own_results_inside_an_exit_trap(self) -> None:
        for callback in ("approval", "config-unlink", "config-rmdir"):
            for primary, result in ((0, 0), (0, 1), (7, 0), (7, 1)):
                with self.subTest(callback=callback, primary=primary, result=result), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    env = self.environment(root, root)
                    env.update(PRIMARY_STATUS=str(primary), CLEANUP_STATUS=str(result), CALLBACK=callback)
                    script = r'''
source "$LAUNCHER"
source "$CONFIG_SOURCE"
release_approval_restore_terminal() { return "$CLEANUP_STATUS"; }
if [[ "$CALLBACK" != approval ]]; then
  release_config_dir="$CASE_ROOT/config"
  if [[ "$CALLBACK" == config-unlink ]]; then
    rm() { return "$CLEANUP_STATUS"; }
    rmdir() { return 0; }
  else
    rm() { return 0; }
    rmdir() { return "$CLEANUP_STATUS"; }
  fi
fi
trap 'set +e
  if [[ "$CALLBACK" == approval ]]; then release_approval_cleanup; else release_config_cleanup; fi
  printf "cleanup=%s\n" "$?"' EXIT
exit "$PRIMARY_STATUS"
'''
                    process = self.launch(script, env)
                    stdout, stderr = process.communicate(timeout=10)
                    self.assertEqual(primary, process.returncode, stdout + stderr)
                    self.assertIn(f"cleanup={result}\n", stdout)


class ReleaseFullCompositionTests(unittest.TestCase):
    """Fake phase producers exercise shell sequencing and reuse, not chain verification."""

    HARNESS = r'''
source "$WRAPPER"
require_release_config() { [[ -f "$1" ]]; }
require_release_file() { [[ -f "$1" && ! -L "$1" ]]; }
reject_release_path_symlinks() { [[ ! -L "$1" ]]; }
validate_new_release_output() { [[ "$1" == "$CASE_ROOT/"* && ! -e "$1" ]]; }
release_full_read_uri_presence() { release_full_has_uri="$HAS_URI"; }
release_full_make() {
  printf '%s\0' "$@" >> "$CASE_ROOT/calls"
  printf '\0' >> "$CASE_ROOT/calls"
  local target="$1" destination="" business="" ui="" root="" records="" argument
  shift
  for argument in "$@"; do
    case "$argument" in
      OUTPUT_DIR=*) destination="${argument#*=}" ;;
      CONTRACT_ARTIFACT=*) business="${argument#*=}" ;;
      UI_ARTIFACT=*) ui="${argument#*=}" ;;
      ROOT_ARTIFACT=*) root="${argument#*=}" ;;
      CAM_RECORDS=*) records="${argument#*=}" ;;
    esac
  done
  if [[ "$target" == "${FAIL_TARGET-}" ]]; then
    mkdir -p -- "$destination"
    if [[ "$target" == */cam/publish ]]; then
      printf 'confirmed root, unfinished bindings\n' > "$destination/partial"
    fi
    return 23
  fi
  case "$target" in
    */contracts/deploy)
      mkdir -p -- "$destination/artifact"
      printf 'verified business\n' > "$destination/artifact/contract-deployment.json" ;;
    */ui/deploy)
      mkdir -p -- "$destination/artifact"
      printf 'verified ui\n' > "$destination/artifact/ui-deployment.json" ;;
    */cam/bundle)
      mkdir -p -- "$destination/inputs" "$destination/artifact"
      cp -- "$business" "$destination/inputs/business.json"
      cp -- "$ui" "$destination/inputs/ui.json"
      if [[ -n "$root" ]]; then cp -- "$root" "$destination/inputs/root.json"; fi
      printf 'verified bundle\n' > "$destination/artifact/cam-bundle.json" ;;
    */cam/publish)
      mkdir -p -- "$destination/artifact"
      if [[ -n "$root" ]]; then
        mkdir -p -- "$destination/root-proof"
        cp -- "$root" "$destination/root-proof/root.json"
      fi
      printf 'verified cam\n' > "$destination/artifact/cam-publication.json" ;;
    */contracts/artifact) [[ -f "$CASE_ROOT/release/contracts/artifact/contract-deployment.json" ]] || return 24 ;;
    */ui/artifact) [[ -f "$CASE_ROOT/release/ui/artifact/ui-deployment.json" ]] || return 24 ;;
    */cam/artifact)
      if [[ -f "$records/artifact/cam-publication.json" ]]; then return 0; fi
      if [[ -f "$records/partial" ]]; then
        mkdir -p -- "$records/artifact"
        cp -- "$records/partial" "$records/artifact/cam-attempt.json"
        return 3
      fi
      return 24 ;;
    *) return 25 ;;
  esac
}
release_full "$APP" "$OPERATION" "$CASE_ROOT/release"
'''

    def fixture(self, root: Path) -> None:
        private = root / "private files"
        private.mkdir()
        for name in ("business.json", "ui.json", "cam.json"):
            (private / name).write_text("{}\n", encoding="utf-8")
        (root / "selected-business.json").write_text("existing business\n", encoding="utf-8")
        (root / "selected-root.json").write_text("original root evidence\n", encoding="utf-8")

    def invoke(self, root: Path, *, app: str, operation: str, uri: bool,
               **changes: str) -> tuple[subprocess.CompletedProcess[str], list[list[str]]]:
        calls = root / "calls"
        calls.write_bytes(b"")
        env = dict(os.environ, WRAPPER=str(ROOT / "tools/release_full.sh"), CASE_ROOT=str(root),
                   CONFIG=str(root / "private files/business.json"), UI_CONFIG=str(root / "private files/ui.json"),
                   CAM_CONFIG=str(root / "private files/cam.json"), APP=app, OPERATION=operation, HAS_URI=str(int(uri)))
        for name in ("ROOT", "ROOT_ARTIFACT", "CAM_BUNDLE", "CONTRACT_ARTIFACT"):
            env.pop(name, None)
        if operation == "update":
            env.update(CONTRACT_ARTIFACT=str(root / "selected-business.json"), ROOT_ARTIFACT=str(root / "selected-root.json"))
        env.update(changes)
        result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", self.HARNESS],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
        commands = [entry.decode().split("\0") for entry in calls.read_bytes().split(b"\0\0") if entry]
        return result, commands

    def test_full_release_uses_ordinary_operations_and_rechecks_existing_records(self) -> None:
        for app in ("bike-nft", "escrow", "pay-to-play"):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                result, calls = self.invoke(root, operation="full", uri=True, app=app)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual([f"{app}/release/{phase}" for phase in
                                  ("contracts/deploy", "ui/deploy", "cam/bundle", "cam/publish")], [call[0] for call in calls])
                self.assertIn(f"CONFIG={root / 'private files/ui.json'}", calls[1])
                self.assertIn(f"CONFIG={root / 'private files/cam.json'}", calls[3])
                original = (root / "release/cam/artifact/cam-publication.json").read_bytes()
                result, calls = self.invoke(root, operation="full", uri=True, app=app)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual([f"{app}/release/{phase}" for phase in
                                  ("contracts/artifact", "ui/artifact", "cam/artifact")], [call[0] for call in calls])
                self.assertEqual(original, (root / "release/cam/artifact/cam-publication.json").read_bytes())

    def test_partial_publication_requires_new_invocation_and_only_continues_remaining_work(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True,
                                        FAIL_TARGET="escrow/release/cam/publish")
            self.assertEqual(23, result.returncode, result.stderr)
            self.assertEqual(1, sum(call[0].endswith("cam/publish") for call in calls))
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(["escrow/release/contracts/artifact", "escrow/release/ui/artifact",
                              "escrow/release/cam/artifact", "escrow/release/cam/publish"], [call[0] for call in calls])
            attempt = root / "release/cam/artifact/cam-attempt.json"
            self.assertIn(f"ROOT_ARTIFACT={attempt}", calls[-1])
            self.assertIn(f"OUTPUT_DIR={root / 'release/cam/continuation'}", calls[-1])
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("escrow/release/cam/artifact", calls[-1][0])
            self.assertIn(f"CAM_RECORDS={root / 'release/cam/continuation'}", calls[-1])
            self.assertFalse(any(call[0].endswith("/deploy") or call[0].endswith("/publish") for call in calls))
            (root / "release/cam/continuation/root-proof/root.json").write_text("different root\n")
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(2, result.returncode, result.stderr)
            self.assertIn("different root evidence", result.stderr)
            self.assertFalse(any(call[0].endswith("cam/publish") for call in calls))

    def test_completed_publication_takes_precedence_over_retained_attempt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, _ = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(0, result.returncode, result.stderr)
            (root / "release/cam/artifact/cam-attempt.json").write_text("earlier attempt\n")
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("escrow/release/cam/artifact", calls[-1][0])
            self.assertFalse(any(call[0].endswith("cam/publish") for call in calls))

    def test_hosting_pause_resumes_after_verifying_components_without_redeployment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, calls = self.invoke(root, app="escrow", operation="full", uri=False)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(3, len(calls))
            self.assertIn("host or pin", result.stdout)
            self.assertFalse((root / "release/cam").exists())
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(["escrow/release/contracts/artifact", "escrow/release/ui/artifact", "escrow/release/cam/publish"],
                             [call[0] for call in calls])

    def test_update_reuses_business_and_selects_only_ui_bundle_and_existing_root_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, calls = self.invoke(root, app="escrow", uri=True, operation="update")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(["escrow/release/ui/deploy", "escrow/release/cam/bundle", "escrow/release/cam/publish"],
                             [call[0] for call in calls])
            self.assertIn(f"CONTRACT_ARTIFACT={root / 'selected-business.json'}", calls[0])
            self.assertIn(f"ROOT_ARTIFACT={root / 'selected-root.json'}", calls[2])
            self.assertFalse((root / "release/contracts").exists())

    def test_failed_phase_stops_then_uses_keyless_completion_instead_of_redeploying(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True, FAIL_TARGET="escrow/release/ui/deploy")
            self.assertEqual(23, result.returncode, result.stderr)
            self.assertEqual(2, len(calls))
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(24, result.returncode, result.stderr)
            self.assertEqual(["escrow/release/contracts/artifact", "escrow/release/ui/artifact"], [call[0] for call in calls])

    def test_retained_bundle_cannot_silently_change_selected_business_or_root(self) -> None:
        for name in ("selected-business.json", "selected-root.json"):
            with self.subTest(selection=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                result, _ = self.invoke(root, app="escrow", operation="update", uri=False)
                self.assertEqual(0, result.returncode, result.stderr)
                (root / name).write_text("different selection\n", encoding="utf-8")
                result, calls = self.invoke(root, app="escrow", uri=True, operation="update")
                self.assertEqual(2, result.returncode, result.stderr)
                self.assertIn("different", result.stderr)
                self.assertNotIn("escrow/release/cam/publish", [call[0] for call in calls])

    def test_incomplete_bundle_can_be_replaced_without_redeploying_verified_components(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, _ = self.invoke(root, app="escrow", operation="full", uri=True, FAIL_TARGET="escrow/release/cam/bundle")
            self.assertEqual(23, result.returncode, result.stderr)
            result, _ = self.invoke(root, app="escrow", operation="full", uri=True)
            self.assertEqual(2, result.returncode, result.stderr)
            self.assertIn("CAM_BUNDLE", result.stderr)
            prepared = root / "recovered-bundle"
            (prepared / "inputs").mkdir(parents=True)
            (prepared / "artifact").mkdir()
            shutil.copyfile(root / "release/contracts/artifact/contract-deployment.json", prepared / "inputs/business.json")
            shutil.copyfile(root / "release/ui/artifact/ui-deployment.json", prepared / "inputs/ui.json")
            (prepared / "artifact/cam-bundle.json").write_text("verified recovered bundle\n", encoding="utf-8")
            result, calls = self.invoke(root, app="escrow", operation="full", uri=True, CAM_BUNDLE=str(prepared))
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual(["escrow/release/contracts/artifact", "escrow/release/ui/artifact", "escrow/release/cam/publish"],
                             [call[0] for call in calls])
            self.assertIn(f"CAM_BUNDLE={prepared}", calls[-1])

    def test_explicit_verification_uses_only_saved_phase_completion_for_full_and_update(self) -> None:
        for operation in ("full", "update"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                result, _ = self.invoke(root, app="escrow", uri=True, operation=operation)
                self.assertEqual(0, result.returncode, result.stderr)
                result, calls = self.invoke(root, app="escrow", operation="verify", uri=False)
                self.assertEqual(0, result.returncode, result.stderr)
                expected = ["escrow/release/ui/artifact", "escrow/release/cam/artifact"]
                if operation == "full":
                    expected.insert(0, "escrow/release/contracts/artifact")
                self.assertEqual(expected, [call[0] for call in calls])

    def test_verification_never_creates_missing_release_or_publication(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result, calls = self.invoke(root, app="escrow", uri=True, operation="verify")
            self.assertEqual(2, result.returncode, result.stderr)
            self.assertEqual([], calls)
            self.assertFalse((root / "release").exists())
            result, _ = self.invoke(root, app="escrow", operation="full", uri=False)
            self.assertEqual(0, result.returncode, result.stderr)
            result, calls = self.invoke(root, app="escrow", uri=True, operation="verify")
            self.assertEqual(24, result.returncode, result.stderr)
            self.assertTrue(all(call[0].endswith("/artifact") for call in calls))
            self.assertFalse((root / "release/cam").exists())

    def test_phase_configuration_paths_are_literal_make_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "unexpected-make-expansion"
            literal = f"{root}/config-$(shell touch {marker}).json"
            capture = root / "capture.mk"
            capture.write_text(".PHONY: capture\ncapture:\n\t@printf '%s\\n' \"$$CONFIG\" \"$$UI_CONFIG\" \"$$CAM_CONFIG\"\n", encoding="utf-8")
            result = subprocess.run(["make", "--no-print-directory", "-f", str(ROOT / "Makefile"), "-f", str(capture),
                                     "capture", f"CONFIG={literal}", f"UI_CONFIG={literal}", f"CAM_CONFIG={literal}"],
                                    cwd=ROOT, capture_output=True, text=True, timeout=10)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertFalse(marker.exists(), "Configuration filenames must not execute Make expressions")
            self.assertEqual([literal] * 3, result.stdout.splitlines())

    def test_cam_root_selection_is_explicit_and_cannot_fall_back_to_an_ambient_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            evidence = root / "root evidence.json"
            evidence.write_text("{}\n", encoding="utf-8")
            cases = (({"ROOT": "new"}, ["new"]),
                     ({"ROOT_ARTIFACT": str(evidence)}, ["existing", str(evidence)]),
                     ({"ROOT": "", "ROOT_ARTIFACT": str(evidence)}, ["existing", str(evidence)]),
                     ({}, None), ({"ROOT": "new", "ROOT_ARTIFACT": str(evidence)}, None), ({"ROOT": "other"}, None))
            for selected, expected in cases:
                with self.subTest(selected=selected):
                    env = dict(os.environ, SELECTOR=str(ROOT / "tools/release_cam.sh"),
                               CAM_RELEASE_ROOT="stale", CAM_RELEASE_ROOT_ARTIFACT_FILE="stale")
                    env.pop("ROOT", None)
                    env.pop("ROOT_ARTIFACT", None)
                    env.update(selected)
                    script = r'''
source "$SELECTOR"
require_release_file() { [[ -f "$1" ]]; }
release_cam_select_root
printf '%s\n' "$CAM_RELEASE_ROOT"
if [[ -v CAM_RELEASE_ROOT_ARTIFACT_FILE ]]; then printf '%s\n' "$CAM_RELEASE_ROOT_ARTIFACT_FILE"; fi
'''
                    result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", script],
                                            env=env, capture_output=True, text=True, timeout=10)
                    if expected is None:
                        self.assertEqual(2, result.returncode, result.stderr)
                        self.assertEqual("", result.stdout)
                    else:
                        self.assertEqual(0, result.returncode, result.stderr)
                        self.assertEqual(expected, result.stdout.splitlines())


if __name__ == "__main__":
    unittest.main()
