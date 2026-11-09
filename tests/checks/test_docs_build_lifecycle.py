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
    stream.write(json.dumps(args) + "\n")

if args[0] == "compose":
    project_option = "-p" if "-p" in args else "--project-name"
    project = args[args.index(project_option) + 1]
    if "run" in args:
        assert state["project"] in (None, project)
        state["project"] = project
        if state["volume"] is None:
            state["volume"] = f"{project}_docs-artifact"
        service = args[-1]
        state["services"].append(service)
        state_file.write_text(json.dumps(state))
        if service == "docs-build" and state["mode"] == "build-fail":
            print("fixture docs build failed", file=sys.stderr)
            sys.exit(17)
        if service == "docs-export":
            if state["mode"] == "export-fail":
                print("fixture docs export failed", file=sys.stderr)
                sys.exit(18)
            output = Path(os.environ["DOCS_OUTPUT_DIR"]) / "site"
            output.mkdir()
            (output / "index.html").write_text("built")
    elif "down" in args:
        assert project == state["project"]
        assert "--volumes" in args and "--remove-orphans" in args
        if state["mode"] == "down-fail":
            print("fixture Compose teardown failed", file=sys.stderr)
            sys.exit(19)
        if state["mode"] != "volume-residue":
            state["volume"] = None
    else:
        raise AssertionError("unexpected Compose operation: " + repr(args))
elif args[0] in ("container", "network", "volume") and args[1] == "ls":
    assert any(arg == f"label=com.docker.compose.project={state['project']}" for arg in args)
    if args[0] == "volume" and state["volume"] is not None:
        print(state["volume"])
else:
    raise AssertionError("unexpected Docker operation: " + repr(args))

state_file.write_text(json.dumps(state))
'''


class DocsBuildLifecycleTests(unittest.TestCase):
    def test_both_services_share_a_project_scoped_tmpfs_volume(self) -> None:
        config = rendered_compose_config("compose/docs.yml", env={
            "LOCAL_UID": "1000",
            "LOCAL_GID": "1000",
            "DOCS_OUTPUT_DIR": "/tmp/docs-lifecycle-output",
        })
        artifact = config["volumes"]["docs-artifact"]
        self.assertEqual("local", artifact["driver"])
        self.assertNotIn("external", artifact)
        self.assertEqual({
            "type": "tmpfs",
            "device": "tmpfs",
            "o": "size=512m,uid=1000,gid=1000,mode=0700,nosuid,nodev,noexec",
        }, artifact["driver_opts"])

        builder = config["services"]["docs-build"]
        exporter = config["services"]["docs-export"]
        self.assertEqual("docs-artifact", compose_volume(builder, "/out")["source"])
        export_mount = compose_volume(exporter, "/artifact")
        self.assertEqual("docs-artifact", export_mount["source"])
        self.assertTrue(export_mount["read_only"])
        self.assertNotIn("/export", [mount["target"] for mount in builder["volumes"]])

    def run_operation(self, root: Path, mode: str) -> tuple[subprocess.CompletedProcess[str], list[list[str]], dict]:
        (root / "output").mkdir()
        (root / "docker.py").write_text(FAKE_DOCKER)
        (root / "state.json").write_text(json.dumps({
            "mode": mode,
            "project": None,
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

    def test_success_exports_and_removes_the_tmpfs_volume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "success")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("built", (root / "output/site/index.html").read_text())
            self.assertEqual(["docs-build", "docs-export"], state["services"])
            self.assertIsNone(state["volume"])
            self.assertEqual(1, sum("down" in call for call in calls))
            self.assertFalse(any(call[:2] in (["volume", "create"], ["volume", "rm"]) for call in calls))

    def test_build_and_export_failures_still_remove_the_volume(self) -> None:
        for mode, expected, services in (
            ("build-fail", 17, ["docs-build"]),
            ("export-fail", 18, ["docs-build", "docs-export"]),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result, calls, state = self.run_operation(root, mode)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual(services, state["services"])
                self.assertIsNone(state["volume"])
                self.assertEqual(1, sum("down" in call for call in calls))
                self.assertFalse((root / "output/site").exists())

    def test_cleanup_failures_are_reported_with_retained_volume(self) -> None:
        for mode in ("down-fail", "volume-residue"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result, calls, state = self.run_operation(root, mode)
                self.assertNotEqual(0, result.returncode)
                self.assertIsNotNone(state["volume"])
                self.assertIn("Docs project/volume cleanup failed", result.stderr)
                self.assertEqual(1, sum("down" in call for call in calls))
