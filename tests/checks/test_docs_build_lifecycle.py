from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from .common import ROOT, compose_volume, rendered_compose_config


FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

root = Path(os.environ["CASE_ROOT"])
args = sys.argv[1:]
assert args[:2] == ["--host", os.environ["CAM_DOCKER_ENDPOINT"]]
args = args[2:]
state_file = root / "state.json"
state = json.loads(state_file.read_text())
with (root / "calls.jsonl").open("a") as stream:
    stream.write(json.dumps({"args": args, "artifact": os.environ.get("DOCS_ARTIFACT_VOLUME")}) + "\n")

if args[:2] == ["volume", "inspect"]:
    if state["volume"] == args[-1]:
        print(args[-1])
    else:
        sys.exit(1)
elif args[:2] == ["volume", "create"]:
    assert state["volume"] is None, "the operation attempted to reuse a volume"
    assert args[-1] == os.environ["DOCS_ARTIFACT_VOLUME"]
    assert any(arg.startswith("dapp32.docs.run=") for arg in args)
    state["volume"] = args[-1]
    print(args[-1])
elif args[:2] == ["volume", "rm"]:
    assert state["volume"] == args[-1]
    if state["mode"] == "volume-rm-fail":
        print("fixture artifact volume removal denied", file=sys.stderr)
        sys.exit(9)
    state["volume"] = None
elif args[0] == "compose" and "run" in args:
    assert state["volume"] == os.environ["DOCS_ARTIFACT_VOLUME"]
    service = args[-1]
    state["services"].append(service)
    if service == "docs-build" and state["mode"] == "build-fail":
        state_file.write_text(json.dumps(state))
        print("fixture docs compilation failed", file=sys.stderr)
        sys.exit(17)
    if service == "docs-export":
        if state["mode"] == "export-fail":
            state_file.write_text(json.dumps(state))
            print("fixture docs export failed", file=sys.stderr)
            sys.exit(18)
        output = Path(os.environ["DOCS_OUTPUT_DIR"]) / "site"
        output.mkdir()
        (output / "index.html").write_text("built")
elif args[0] == "compose" and "down" in args:
    if state["mode"] == "down-fail":
        print("fixture Compose teardown failed", file=sys.stderr)
        sys.exit(19)
elif args[0] in ("container", "network", "volume") and args[1] == "ls":
    assert any(arg.startswith("label=com.docker.compose.project=") for arg in args)
    # External artifact volume has our own owner label, not Compose's.
else:
    raise AssertionError("unexpected Docker operation: " + repr(args))

state_file.write_text(json.dumps(state))
'''


class DocsBuildLifecycleTests(unittest.TestCase):
    def test_both_services_reference_one_external_volume(self) -> None:
        config = rendered_compose_config("compose/docs.yml", env={
            "DOCS_ARTIFACT_VOLUME": "docs-lifecycle-test-artifact",
            "DOCS_OUTPUT_DIR": "/tmp/docs-lifecycle-output",
        })
        artifact = config["volumes"]["docs-artifact"]
        self.assertTrue(artifact["external"])
        self.assertEqual("docs-lifecycle-test-artifact", artifact["name"])

        builder = config["services"]["docs-build"]
        exporter = config["services"]["docs-export"]
        self.assertEqual("docs-artifact", compose_volume(builder, "/out")["source"])
        export_mount = compose_volume(exporter, "/artifact")
        self.assertEqual("docs-artifact", export_mount["source"])
        self.assertTrue(export_mount["read_only"])
        self.assertNotIn("/export", [mount["target"] for mount in builder["volumes"]])

    def run_operation(self, root: Path, mode: str) -> tuple[subprocess.CompletedProcess[str], list[dict], dict]:
        (root / "output").mkdir()
        (root / "docker.py").write_text(FAKE_DOCKER)
        (root / "state.json").write_text(json.dumps({
            "mode": mode,
            "volume": None,
            "services": [],
        }))
        docker = root / "docker"
        docker.write_text(
            "#!/usr/bin/env bash\n"
            f'if [[ $1 == context ]]; then exec "{ROOT / "tests/fixtures/docker-context/docker"}" "$@"; fi\n'
            'exec "$PYTHON" "$CASE_ROOT/docker.py" "$@"\n'
        )
        docker.chmod(0o755)
        endpoint = "unix:///tmp/docs-test-selected.sock"
        environment = {
            **os.environ,
            "CASE_ROOT": str(root),
            "PYTHON": sys.executable,
            "CAM_DOCKER_ENDPOINT": endpoint,
            "TEST_EXPECTED_DOCKER_ENDPOINT": endpoint,
            "ENDPOINT": endpoint,
            "TRACE": str(root / "selector-trace"),
            "PATH": f"{root}:{ROOT / 'tests/fixtures/docker-context'}:{os.environ['PATH']}",
            "DOCS_OUTPUT_DIR": str(root / "output"),
        }
        makefile = (
            f"include {ROOT / 'Makefile'}\n"
            "override LANE_GUARD := true\n"
            "override PACKAGE_DEPS_GUARD := true\n"
        )
        expanded = subprocess.run(
            ["make", "--no-print-directory", "-n", "-f", "-", "docs/build",
             "DOCKER_CONTEXT=fixture", f"DOCS_OUTPUT_DIR={root / 'output'}"],
            cwd=ROOT, env=environment, input=makefile,
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(0, expanded.returncode, expanded.stderr)

        result = subprocess.run(
            ["bash", "-eu", "-o", "pipefail", "-c", expanded.stdout],
            cwd=ROOT, env=environment, capture_output=True, text=True, timeout=20,
        )
        calls = [json.loads(line) for line in (root / "calls.jsonl").read_text().splitlines()]
        state = json.loads((root / "state.json").read_text())
        return result, calls, state

    def test_success_exports_then_removes_the_unique_volume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "success")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("built", (root / "output/site/index.html").read_text())
            self.assertEqual(["docs-build", "docs-export"], state["services"])
            self.assertIsNone(state["volume"])
            created = next(call for call in calls if call["args"][:2] == ["volume", "create"])
            removed = next(call for call in calls if call["args"][:2] == ["volume", "rm"])
            self.assertEqual(created["args"][-1], removed["args"][-1])
            self.assertEqual(created["args"][-1], created["artifact"])
            self.assertLess(
                next(i for i, call in enumerate(calls) if "down" in call["args"]),
                next(i for i, call in enumerate(calls) if call["args"][:2] == ["volume", "rm"]),
            )

    def test_failures_still_remove_the_artifact_without_exporting(self) -> None:
        for mode, expected, services in (
            ("build-fail", 17, ["docs-build"]),
            ("export-fail", 18, ["docs-build", "docs-export"]),
            ("down-fail", 1, ["docs-build", "docs-export"]),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result, calls, state = self.run_operation(root, mode)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual(services, state["services"])
                self.assertIsNone(state["volume"])
                self.assertEqual(1, sum(call["args"][:2] == ["volume", "rm"] for call in calls))
                if mode in ("build-fail", "export-fail"):
                    self.assertFalse((root / "output/site").exists())

    def test_volume_removal_failure_is_reported_and_not_silenced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "volume-rm-fail")
            self.assertNotEqual(0, result.returncode)
            self.assertIn("Docs artifact volume removal failed", result.stderr)
            self.assertIn("Docs artifact volume still exists", result.stderr)
            self.assertIsNotNone(state["volume"])
            self.assertEqual(1, sum(call["args"][:2] == ["volume", "rm"] for call in calls))
