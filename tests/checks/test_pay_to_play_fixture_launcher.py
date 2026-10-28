"""Fixture lifecycle and descriptor delivery through the real host launcher, without an engine."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .common import ROOT


EXECUTOR = r'''
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ["CASE_ROOT"])
state_path = root / "state.json"
state = json.loads(state_path.read_text())
a = sys.argv[1:]
mode = os.environ["CASE_MODE"]
def save(): state_path.write_text(json.dumps(state))
if a[0] == "deps":
    print("dependency verification diagnostics")
elif a[:2] == ["network", "create"]:
    token = next(v.split("=", 1)[1] for v in a if v.startswith("io.cam.fixture.creation="))
    state["owner"] = "other" if mode == "collision" else token
    save()
    if mode in ("collision", "lost-create-response", "cleanup-probe-hang"): sys.exit(7)
    print("network-id")
elif a[0] in ("container", "network", "volume") and a[1] == "ls":
    if mode == "preflight-probe-hang" or (mode == "cleanup-probe-hang" and any("io.cam.fixture.creation=" in arg for arg in a)):
        time.sleep(30)
    if mode == "existing": print("existing-id")
    elif mode == "stopped-container" and a[0] == "container" and "--all" in a: print("stopped-id")
    elif a[0] == "network" and state.get("owner"):
        filters = [v for v in a if v.startswith("label=io.cam.fixture.creation=")]
        if filters and filters[0].split("=", 2)[2] == state["owner"]: print("network-id")
elif a[0] == "compose":
    if "down" in a:
        if mode == "down-hang":
            state["downEntered"] = True
            save()
            time.sleep(30)
        state["owner"] = None
        state["downs"] += 1
        save()
    elif "up" in a:
        print("build and readiness diagnostics")
    elif "deploy-pay-to-play-local" in a:
        print("deployment diagnostics")
        if mode == "deploy-failure": sys.exit(8)
    elif "pay-to-play-fixture-info" in a:
        if mode == "descriptor-failure": sys.exit(9)
        print(json.dumps({"schema": "pay-to-play.local-fixture.v1", "fixtureId": os.environ["FIXTURE_ID"],
                          "composeProject": os.environ["COMPOSE_PROJECT_NAME"], "rpcUrl": "http://pay-to-play-anvil:8545"}))
    else: raise AssertionError(a)
else: raise AssertionError(a)
'''

BOOT = r'''
docker() { python3 "$CASE_EXECUTOR" "$@"; }
timeout() {
  if [[ "$1" == -k && "$4" == docker ]]; then
    local kill_after="$2" duration="$3"; shift 4
    command "$REAL_TIMEOUT" -k "$kill_after" "$duration" python3 "$CASE_EXECUTOR" "$@"
  else command "$REAL_TIMEOUT" "$@"; fi
}
setsid() {
  if [[ "$1" == timeout && "$5" == docker ]]; then shift 4; fi
  if [[ "$CASE_MODE" == down-hang && "$1" == timeout ]]; then
    [[ "$2 $3 $4" == '-k 15s 60s' ]] || return 99
    shift 4
    # Retain the real TERM-ignoring cleanup; accelerate only its outer deadline.
    exec "$REAL_SETSID" "$REAL_TIMEOUT" -k 1s 1s "$@"
  fi
  case "$1" in
    docker) shift; exec "$REAL_SETSID" python3 "$CASE_EXECUTOR" "$@" ;;
    fixture-make) exec "$REAL_SETSID" python3 "$CASE_EXECUTOR" deps ;;
    *) exec "$REAL_SETSID" "$@" ;;
  esac
}
export -f docker setsid timeout
if [[ "$CASE_MODE" == down-hang ]]; then
  export FIXTURE_ID=owned-test
  exec bash tools/pay_to_play_fixture.sh down
fi
exec bash tools/pay_to_play_fixture.sh up
'''


class FixtureLauncherTest(unittest.TestCase):
    def run_case(self, mode, *, broken_pipe):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executor = root / "executor.py"
            executor.write_text(EXECUTOR)
            state = root / "state.json"
            state.write_text(json.dumps({"owner": None, "downs": 0}))
            env = {key: value for key, value in os.environ.items() if key != "FIXTURE_ID"}
            env.update(CASE_ROOT=str(root), CASE_EXECUTOR=str(executor), CASE_MODE=mode, MAKE="fixture-make", REAL_SETSID=shutil.which("setsid"), REAL_TIMEOUT=shutil.which("timeout"))
            if broken_pipe:
                with (root / "stderr").open("w") as diagnostic:
                    process = subprocess.Popen(["bash", "-euo", "pipefail", "-c", BOOT], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=diagnostic)
                    process.stdout.close()
                    code = process.wait(timeout=15)
                return code, "", (root / "stderr").read_text(), json.loads(state.read_text())
            # Forced teardown may also need the owner's bounded group-retirement grace.
            deadline = 100 if mode == "down-hang" else 15
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", BOOT], cwd=ROOT, env=env, capture_output=True, text=True, timeout=deadline)
            return result.returncode, result.stdout, result.stderr, json.loads(state.read_text())

    def test_success_returns_only_one_json_line_and_leaves_fixture_owned_by_caller(self):
        code, output, diagnostic, state = self.run_case("success", broken_pipe=False)
        self.assertEqual(0, code, diagnostic)
        self.assertEqual(1, len(output.splitlines()))
        descriptor = json.loads(output)
        self.assertRegex(descriptor["fixtureId"], r"^run-[0-9a-f]{32}$")
        self.assertIn(descriptor["fixtureId"], diagnostic)
        self.assertIn(f"-C {ROOT}", diagnostic)
        self.assertIn("dependency verification diagnostics", diagnostic)
        self.assertIn("deployment diagnostics", diagnostic)
        self.assertEqual(0, state["downs"])
        self.assertIsNotNone(state["owner"])

    def test_failed_start_or_descriptor_delivery_cleans_owned_fixture(self):
        for mode in ("lost-create-response", "deploy-failure", "descriptor-failure"):
            with self.subTest(mode=mode):
                code, output, diagnostic, state = self.run_case(mode, broken_pipe=False)
                self.assertNotEqual(0, code, diagnostic)
                self.assertEqual("", output)
                self.assertEqual(1, state["downs"])
                self.assertIsNone(state["owner"])

    def test_existing_or_concurrent_collision_is_preserved(self):
        for mode in ("existing", "stopped-container", "collision"):
            with self.subTest(mode=mode):
                code, output, diagnostic, state = self.run_case(mode, broken_pipe=False)
                self.assertNotEqual(0, code, diagnostic)
                self.assertEqual("", output)
                self.assertEqual(0, state["downs"])
                if mode == "collision": self.assertEqual("other", state["owner"])

    def test_broken_stdout_rolls_back_instead_of_leaving_an_unreturned_fixture(self):
        code, _, diagnostic, state = self.run_case("success", broken_pipe=True)
        self.assertNotEqual(0, code, diagnostic)
        self.assertEqual(1, state["downs"])
        self.assertIsNone(state["owner"])

    def test_engine_inspection_is_bounded_and_unknown_ownership_is_not_deleted(self):
        for mode in ("preflight-probe-hang", "cleanup-probe-hang"):
            with self.subTest(mode=mode):
                code, output, diagnostic, state = self.run_case(mode, broken_pipe=False)
                self.assertNotEqual(0, code, diagnostic)
                self.assertEqual("", output)
                self.assertEqual(0, state["downs"])
                self.assertIn("inspect" if mode == "preflight-probe-hang" else "ownership could not be checked", diagnostic)

    def test_direct_teardown_has_a_deadline_even_without_cancellation(self):
        code, output, diagnostic, state = self.run_case("down-hang", broken_pipe=False)
        self.assertNotEqual(0, code, diagnostic)
        self.assertNotEqual(99, code, diagnostic)
        self.assertIs(state.get("downEntered"), True)
        self.assertEqual("", output)
        self.assertIn("Fixture operation failed", diagnostic)
