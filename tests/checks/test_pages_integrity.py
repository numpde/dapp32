"""Read-only publication auditing is independent of the publishers."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tools import pages_integrity

from .common import ROOT


REPOSITORY = "numpde/dapp32"
WORKFLOW = "Viewer qualification and automatic Pages publication"
WORKFLOW_PATH = "viewer-pages-preview.yml"
OLD_SHA = "a" * 40
NEW_SHA = "b" * 40


def run(run_id: int, source: str, *, status: str) -> dict:
    return {"id": run_id, "head_sha": source, "head_branch": "main",
            "event": "push", "status": status, "name": WORKFLOW,
            "repository": {"full_name": REPOSITORY}}


def recorded_manifest() -> dict:
    return {"schema": "viewer-publication/v1", "source_sha": OLD_SHA,
            "qualified_run_id": 101, "files": {"index.html": "0" * 64}}


def api_with_runs(new_job: str, *, current_status: str = "completed"):
    records = [run(102, NEW_SHA, status="completed"), run(101, OLD_SHA, status=current_status)]
    def read(path: str) -> dict:
        if "/runs?" in path:
            return {"workflow_runs": records}
        if path == "actions/runs/101":
            return records[1]
        if path == "actions/runs/101/jobs?per_page=100":
            return {"jobs": [{"name": "candidate", "conclusion": "success"}]}
        if path == "actions/runs/102/jobs?per_page=100":
            return {"jobs": [{"name": "candidate", "conclusion": new_job}]}
        raise AssertionError(path)
    return read


class PublicationIntegrityTest(unittest.TestCase):
    def test_changes_to_shared_qualification_checker_trigger_both_publishers(self) -> None:
        for name in ("docs-pages-candidate.yml", "viewer-pages-preview.yml"):
            with self.subTest(workflow=name):
                workflow = (ROOT / ".github/workflows" / name).read_text(encoding="utf-8")
                self.assertEqual(2, workflow.count("- tools/pages_integrity.py"))
                self.assertEqual(2, workflow.count("- tests/checks/test_pages_integrity.py"))

    def test_publisher_uses_latest_qualified_run_not_unrelated_main_head(self) -> None:
        # The publishing run is still in progress, but its candidate is qualified.
        pages_integrity.check_current_qualification(
            "viewer", OLD_SHA, 101, api_with_runs("failure", current_status="in_progress")
        )
        with self.assertRaisesRegex(ValueError, "qualification superseded"):
            pages_integrity.check_current_qualification(
                "viewer", OLD_SHA, 101, api_with_runs("success")
            )

    def test_independent_publisher_audits_are_never_canceled_by_another_audit(self) -> None:
        workflow = (ROOT / ".github/workflows/pages-integrity.yml").read_text(encoding="utf-8")
        self.assertNotIn("\nconcurrency:\n", workflow)

    def test_fails_when_newer_candidate_qualified_but_its_publication_is_pending(self) -> None:
        # Success of the whole workflow would miss a qualified candidate whose
        # publication step failed; the independent check must detect the lag.
        with self.assertRaisesRegex(ValueError, f"latest qualified={NEW_SHA}"):
            pages_integrity.check_freshness("viewer", recorded_manifest(), REPOSITORY,
                                            api_with_runs("success"))

    def test_unqualified_newer_run_does_not_make_published_source_stale(self) -> None:
        pages_integrity.check_freshness("viewer", recorded_manifest(), REPOSITORY,
                                        api_with_runs("failure"))

    def test_in_progress_newer_candidate_does_not_prematurely_report_drift(self) -> None:
        reader = api_with_runs("success")
        def in_progress(path: str) -> dict:
            response = reader(path)
            if "/runs?" in path:
                return {"workflow_runs": [{**response["workflow_runs"][0], "status": "in_progress"},
                                          response["workflow_runs"][1]]}
            return response
        pages_integrity.check_freshness("viewer", recorded_manifest(), REPOSITORY, in_progress)

    def test_rejects_recorded_run_that_never_qualified_the_published_source(self) -> None:
        manifest = recorded_manifest()
        manifest["source_sha"] = NEW_SHA
        with self.assertRaisesRegex(ValueError, "recorded run 101 did not qualify"):
            pages_integrity.check_freshness("viewer", manifest, REPOSITORY,
                                            api_with_runs("success"))

    def test_verifies_docs_with_existing_source_aware_checker(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            site, source = root / "site", root / "source"
            site.mkdir()
            source.mkdir()
            manifest = {"source_sha": OLD_SHA, "qualified_run_id": 101,
                        "files": {"index.html": "0" * 64}}
            (site / "docs-publication.json").write_text(json.dumps(manifest), encoding="utf-8")
            with patch.object(pages_integrity.docs_site, "check_published") as checked:
                received, files = pages_integrity.local_files("docs", site, source)
            checked.assert_called_once_with(source, site)
            self.assertEqual(manifest, received)
            self.assertEqual({**manifest["files"], "docs-publication.json": sha256(
                (site / "docs-publication.json").read_bytes()
            ).hexdigest()}, files)

    def test_verifies_viewer_manifest_as_a_publicly_served_file(self) -> None:
        with TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "viewer").mkdir()
            manifest = recorded_manifest()
            provenance = site / "viewer/viewer-publication.json"
            provenance.write_text(json.dumps(manifest), encoding="utf-8")
            with patch.object(pages_integrity.viewer_pages, "check_published", return_value=manifest):
                received, files = pages_integrity.local_files("viewer", site, None)
            self.assertEqual(manifest, received)
            self.assertEqual({"viewer/index.html": manifest["files"]["index.html"],
                              "viewer/viewer-publication.json": sha256(provenance.read_bytes()).hexdigest()},
                             files)

    def test_served_bytes_must_match_all_recorded_files(self) -> None:
        with TemporaryDirectory() as directory:
            site = Path(directory)
            (site / "index.html").write_bytes(b"published html")
            (site / "asset.js").write_bytes(b"published javascript")
            data = {"index.html": b"published html", "asset.js": b"published javascript"}
            files = {name: sha256(value).hexdigest() for name, value in data.items()}
            visited: list[tuple[str, int]] = []
            def fetch(name: str, size: int) -> bytes:
                visited.append((name, size))
                return data[name]
            pages_integrity.check_served_files(site, files, fetch)
            self.assertEqual({(name, len(value)) for name, value in data.items()},
                             set(visited))
            with patch.object(pages_integrity.time, "sleep"):
                data["asset.js"] = b"x" * len(data["asset.js"])
                with self.assertRaisesRegex(ValueError, "different bytes: asset.js"):
                    pages_integrity.check_served_files(site, files, fetch)
                data["asset.js"] = b"tampered"
                with self.assertRaisesRegex(ValueError, "different bytes: asset.js"):
                    pages_integrity.check_served_files(site, files, fetch)
                def inaccessible(name: str, size: int) -> bytes:
                    raise OSError("HTTPS service unavailable")
                with self.assertRaisesRegex(ValueError, "unreachable"):
                    pages_integrity.check_served_files(site, files, inaccessible)
