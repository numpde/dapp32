from __future__ import annotations

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

CLEANUP = ROOT / "tools/compose_cleanup.sh"
PROJECT = "dapp32-cleanup-test"

FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, time
root = pathlib.Path(os.environ["CASE_ROOT"])
args = sys.argv[1:]
with (root / "calls").open("a") as stream:
    stream.write(json.dumps(args) + "\n")
state = json.loads((root / "state").read_text())
def save():
    (root / "state").write_text(json.dumps(state))
if args[0] == "compose":
    assert args.index("--project-name") < args.index("down")
    if state["mode"] == "blocked" and not (root / "continue").exists():
        (root / "entered").touch()
        while not (root / "continue").exists():
            time.sleep(0.01)
    if state["mode"] == "down-failure":
        print("fixture teardown denied", file=sys.stderr)
        sys.exit(7)
    if state["mode"] != "retained":
        state["container"] = False
    if not state["container"]:
        state["network"] = False
        if state["mode"] != "volume-residue":
            state["volume"] = False
    save()
elif args[1] == "ls":
    assert "label=com.docker.compose.project=dapp32-cleanup-test" in args
    if state["mode"] == "listing-failure":
        print("fixture engine listing failed", file=sys.stderr)
        sys.exit(8)
    if state[args[0]]:
        print("a" * 64)
else:
    raise SystemExit("unexpected fixture Docker operation: " + repr(args))
'''

class ComposeCleanupTest(unittest.TestCase):
    def prepare(self, root: Path, mode: str) -> dict[str, str]:
        docker = root / "docker.py"
        docker.write_text(FAKE_DOCKER)
        (root / "fixture.yml").write_text("services:\n  fixture:\n    image: fixture:local\n")
        (root / "state").write_text(json.dumps({
            "mode": mode, "container": mode in ("native", "retained", "blocked"),
            "network": True, "volume": True,
        }))
        return {**os.environ, "CASE_ROOT": str(root), "PYTHON": sys.executable}

    def command(self, root: Path) -> list[str]:
        wrapper = 'docker() { "$PYTHON" "$CASE_ROOT/docker.py" "$@"; }; export -f docker; exec bash "$@"'
        return ["bash", "-c", wrapper, "cleanup-test", str(CLEANUP), PROJECT, "--rmi", "local", "--", "docker", "compose", "-f", str(root / "fixture.yml")]

    def test_native_teardown_ends_with_no_owned_resources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(self.command(root), env=self.prepare(root, "native"), capture_output=True, text=True, timeout=10)
            self.assertEqual(0, result.returncode, result.stderr)
            state = json.loads((root / "state").read_text())
            self.assertFalse(any(state[kind] for kind in ("container", "network", "volume")))
            calls = [json.loads(line) for line in (root / "calls").read_text().splitlines()]
            self.assertEqual("compose", calls[0][0], "Compose owns resource teardown")
            self.assertEqual(["--rmi", "local"], calls[0][-2:], "caller image cleanup policy is preserved")
            self.assertFalse(any(call[:2] == ["container", "rm"] for call in calls))
            actual_cli = subprocess.run([shutil.which("docker"), *calls[0], "--help"], capture_output=True, text=True, timeout=10)
            self.assertEqual(0, actual_cli.returncode, actual_cli.stderr)

    def test_failure_and_false_success_are_not_reported_as_clean(self) -> None:
        for mode, expected, reason in (
            ("down-failure", 7, "fixture teardown denied"),
            ("listing-failure", 8, "fixture engine listing failed"),
            ("volume-residue", 1, "Cleanup left volume"),
            ("retained", 1, "Cleanup left container"),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = subprocess.run(self.command(root), env=self.prepare(root, mode), capture_output=True, text=True, timeout=10)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertIn(reason, result.stderr)

    def test_repeated_cancellation_does_not_interrupt_teardown(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            process = subprocess.Popen(self.command(root), env=self.prepare(root, "blocked"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 5
                while not (root / "entered").exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue((root / "entered").exists())
                process.send_signal(signal.SIGTERM)
                (root / "continue").touch()
                stdout, stderr = process.communicate(timeout=10)
                self.assertEqual(0, process.returncode, stdout + stderr)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_different_cli_engine_selection_is_rejected_before_any_removal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = subprocess.run(["bash", str(CLEANUP), PROJECT, "--", "docker", "--context", "elsewhere", "compose"], env=self.prepare(root, "native"), capture_output=True, text=True, timeout=10)
            self.assertEqual(2, result.returncode)
            self.assertFalse((root / "calls").exists())

    def test_make_cleanup_preserves_primary_failure_and_retains_inputs_on_cleanup_failure(self) -> None:
        for primary, mode, expected in ((0, "native", 0), (0, "down-failure", 7), (23, "down-failure", 23), (23, "native", 23)):
            with self.subTest(primary=primary, mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env = self.prepare(root, mode)
                functions = root / "functions"
                functions.write_text('docker() { "$PYTHON" "$CASE_ROOT/docker.py" "$@"; }; export -f docker\n')
                env["BASH_ENV"] = str(functions)
                makefile = f'''include {ROOT / "Makefile"}
.PHONY: fixture/cleanup
fixture/cleanup:
\t@cleanup() {{ status="$$?"; $(call cleanup_disposable_project,{PROJECT},-f {root / "fixture.yml"},$$status); touch {root / "inputs-released"}; exit "$$status"; }}; trap cleanup EXIT; exit {primary}
'''
                expanded = subprocess.run(["make", "--no-print-directory", "-n", "-f", "-", "fixture/cleanup"], input=makefile, cwd=ROOT, env=env, text=True, capture_output=True, timeout=10)
                self.assertEqual(0, expanded.returncode, expanded.stderr)
                result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", expanded.stdout], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual(mode == "native", (root / "inputs-released").exists())
                if mode == "down-failure":
                    self.assertIn("fixture teardown denied", result.stderr)

    def test_two_project_down_attempts_second_cleanup_after_first_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "cleanup-calls"
            functions = root / "functions"
            functions.write_text('timeout() { printf "%s\\n" "$*" >> "$CALLS"; [[ "$*" == *with-writes* ]]; }; env() { shift 2; "$@"; }; export -f timeout env\n')
            env = {**os.environ, "BASH_ENV": str(functions), "CALLS": str(calls)}
            result = subprocess.run(["make", "--no-print-directory", "bike-nft/local/integration/fuzz/down"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(0, result.returncode, result.stderr)
            self.assertTrue(calls.exists(), result.stderr)
            attempts = calls.read_text().splitlines()
            self.assertEqual(2, len(attempts), "failure must not abandon the second owned project")
            self.assertNotIn("with-writes", attempts[0])
            self.assertIn("with-writes", attempts[1])
