"""Check acquisition policy with fixtures in Docker's native stage-list format.

The fixtures supply stage lists; these tests cover source selection, pin
policy and failure effects without implementing another Dockerfile parser.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from .common import ROOT
from .docker_test_support import ENDPOINT


NODE = "docker.io/library/node:24@sha256:" + "a" * 64
PYTHON = "docker.io/library/python:3@sha256:" + "b" * 64


class BaseImagesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "tools").mkdir()
        (self.root / "containers").mkdir()
        shutil.copyfile(ROOT / "tools/base_images.py", self.root / "tools/base_images.py")
        self.log = self.root / "docker.log"
        self.responses = {}
        self.response_path = self.root / "targets.json"
        self.environment = dict(os.environ, PATH=f"{ROOT / 'tests/fixtures/base-images'}:{os.environ['PATH']}",
                                CAM_DOCKER_ENDPOINT=ENDPOINT, ENDPOINT=ENDPOINT, PULL_LOG=str(self.log),
                                PULL_STATUS="0", NATIVE_TARGETS=str(self.response_path))
        if "DOCKERFILES" in self.environment:
            del self.environment["DOCKERFILES"]

    def dockerfile(self, name: str, stages: object) -> Path:
        path = self.root / "containers" / name / "Dockerfile"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("# Native target responses are supplied by the fixture, not a second parser.\n")
        self.responses[str(path.relative_to(self.root))] = {"targets": stages}
        self.response_path.write_text(json.dumps(self.responses))
        return path

    def run_acquisition(self, **settings: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, "-I", "-B", str(self.root / "tools/base_images.py")],
                              env=self.environment | settings, text=True, capture_output=True,
                              timeout=10, check=False)

    def calls(self) -> list[str]:
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_discovers_new_dockerfiles_and_deduplicates_native_stage_bases(self) -> None:
        self.dockerfile("first", [{"base": NODE, "name": "build"}, {"base": "build", "name": "runtime"}])
        self.dockerfile("nested/new", [{"base": PYTHON}, {"base": NODE}, {"base": "scratch"}])
        result = self.run_acquisition()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [f"--host {ENDPOINT} pull {NODE}", f"--host {ENDPOINT} pull {PYTHON}"])

    def test_external_syntax_frontend_is_rejected_before_buildx_or_pull(self) -> None:
        path = self.dockerfile("first", [{"base": NODE}])
        directives = (
            "# syntax=docker/dockerfile:1.19",
            "#syntax=docker/dockerfile:1.19",
            "# SYNTAX = docker/dockerfile:1.19",
            "  # syntax=docker/dockerfile:1.19",
        )
        for directive in directives:
            with self.subTest(directive=directive):
                path.write_text(directive + "\nFROM " + NODE + "\n")
                result = self.run_acquisition()
                self.assertNotEqual(0, result.returncode)
                self.assertIn("syntax frontend", result.stderr)
                self.assertEqual([], self.calls())

    def test_subset_does_not_acquire_unselected_images(self) -> None:
        self.dockerfile("first", [{"base": NODE}])
        self.dockerfile("other", [{"base": PYTHON}])
        result = self.run_acquisition(DOCKERFILES="containers/other/Dockerfile")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [f"--host {ENDPOINT} pull {PYTHON}"])

    def test_checks_all_native_bases_before_pulling(self) -> None:
        self.dockerfile("first", [{"base": NODE}])
        for stages in ([{"base": "node:24"}], [{"base": "${BASE}"}], [], None, [None],
                       [{"name": "missing-base"}], [{"base": NODE}, {"base": ""}],
                       [{"base": NODE, "platform": "linux/arm64"}]):
            with self.subTest(stages=stages):
                self.dockerfile("last", stages)
                result = self.run_acquisition()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("containers/last/Dockerfile", result.stderr)
                self.assertEqual(self.calls(), [])

    def test_native_discovery_failure_stops_before_any_base_pull(self) -> None:
        self.dockerfile("first", [{"base": NODE}])
        self.dockerfile("last", [{"base": PYTHON}])
        self.responses["containers/last/Dockerfile"] = {"status": 29}
        self.response_path.write_text(json.dumps(self.responses))
        result = self.run_acquisition()
        self.assertEqual(result.returncode, 29)
        self.assertIn("native discovery", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_rejects_missing_outside_and_symlink_inputs(self) -> None:
        path = self.dockerfile("first", [{"base": NODE}])
        for selected in (str(path), "containers/../containers/first/Dockerfile", "containers/missing/Dockerfile", "   "):
            with self.subTest(selected=selected):
                result = self.run_acquisition(DOCKERFILES=selected)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])
        path.rename(path.with_suffix(".saved"))
        path.symlink_to(path.with_suffix(".saved"))
        result = self.run_acquisition()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("symlink", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_pull_failure_preserves_status_and_stops_later_pulls(self) -> None:
        self.dockerfile("first", [{"base": NODE}, {"base": PYTHON}])
        result = self.run_acquisition(PULL_STATUS="23")
        self.assertEqual(result.returncode, 23)
        self.assertIn("earlier images may remain cached", result.stderr)
        self.assertEqual(self.calls(), [f"--host {ENDPOINT} pull {NODE}"])

    def test_make_entrypoint_passes_selected_endpoint_and_literal_inputs(self) -> None:
        self.responses["containers/viewer/Dockerfile"] = {"targets": [{"base": NODE}]}
        self.response_path.write_text(json.dumps(self.responses))
        result = subprocess.run(["make", "--no-print-directory", "base-images/pull", "DOCKER_CONTEXT=fixture",
                                 "DOCKERFILES=containers/viewer/Dockerfile"], cwd=ROOT, env=self.environment,
                                text=True, capture_output=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [f"--host {ENDPOINT} pull {NODE}"])
        result = subprocess.run(["make", "--no-print-directory", "base-images/pull", "DOCKER_CONTEXT=fixture",
                                 "DOCKERFILES=$(shell touch /tmp/base-images-must-not-execute)"],
                                cwd=ROOT, env=self.environment, text=True, capture_output=True, timeout=10, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Make expression", result.stderr)
        self.assertEqual(len(self.calls()), 1)
