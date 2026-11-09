"""Generated-site staging and independent-viewer preservation checks."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.docs_site import check, check_published, stage

from .common import ROOT


DOCS = ROOT / "docs"


def artifact_fixture(root: Path) -> Path:
    artifact = root / "built"
    artifact.mkdir()
    for page in DOCS.rglob("*.md"):
        relative = page.relative_to(DOCS)
        output = relative.parent / ("index.html" if relative.name == "index.md"
                                    else relative.stem + ".html")
        target = artifact / output
        target.parent.mkdir(parents=True, exist_ok=True)
        ids = ""
        if output == Path("gallery/index.html"):
            ids = '<div id="load-status"></div><button id="retry"></button><div id="deployments"></div>'
        if output == Path("deployment/networks/index.html"):
            ids = ''.join(f'<div id="{name}"></div>'
                          for name in ("load-status", "reference", "networks", "network-jump"))
        target.write_text("<!doctype html><html><body>" + ids + ("document " * 30)
                          + "</body></html>", encoding="utf-8")
    for version in ("1.1.0", "1.2.0", "1.3.0", "1.4.0"):
        path = Path("reference/cam") / version / "index.html"
        destination = artifact / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DOCS / path, destination)
    catalog = artifact / "gallery/deployments.json"
    catalog.write_text(json.dumps({"deployments": [{"app": "fixture"}]}))
    redirect = artifact / "deployments/index.html"
    redirect.parent.mkdir(parents=True, exist_ok=True)
    redirect.write_text("<!doctype html><html><body>Gallery redirect</body></html>")
    (artifact / "assets").mkdir()
    (artifact / "assets/app.js").write_text("export const ok = true;")
    return artifact


def previous_site(root: Path) -> Path:
    site = root / "site"
    (site / ".git").mkdir(parents=True)
    (site / ".git/HEAD").write_text("ref: refs/heads/gh-pages\n")
    (site / "viewer/assets").mkdir(parents=True)
    (site / "viewer/index.html").write_text("independent viewer")
    (site / "viewer/assets/entry.js").write_text("independent viewer assets")
    (site / "viewer/deploy.html").write_text("old hosting guide")
    (site / "gallery").mkdir()
    (site / "gallery/index.html").write_text("old gallery")
    (site / "site.css").write_text("old CSS")
    (site / "check_pages.py").write_text("old check")
    (site / ".github/workflows").mkdir(parents=True)
    (site / ".github/workflows/pages-check.yml").write_bytes(
        (DOCS / "publishing/pages-check.yml").read_bytes()
    )
    (site / ".github/workflows/viewer-recipe-check.yml").write_text("old check")
    return site


class DocsPublishedTests(unittest.TestCase):
    def test_stage_retires_legacy_docs_without_touching_viewer(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            built = artifact_fixture(root)
            site = previous_site(root)
            original_viewer = (site / "viewer/index.html").read_bytes()
            original_asset = (site / "viewer/assets/entry.js").read_bytes()

            stage(DOCS, built, site, "a" * 40, "1234")
            check_published(DOCS, site)

            self.assertEqual(original_viewer, (site / "viewer/index.html").read_bytes())
            self.assertEqual(original_asset, (site / "viewer/assets/entry.js").read_bytes())
            self.assertFalse((site / "site.css").exists())
            self.assertFalse((site / "check_pages.py").exists())
            self.assertFalse((site / ".github/workflows/pages-navigation.yml").exists())
            self.assertEqual("old check", (site / ".github/workflows/viewer-recipe-check.yml").read_text())
            self.assertEqual((DOCS / "publishing/pages-check.yml").read_bytes(),
                             (site / ".github/workflows/pages-check.yml").read_bytes())
            manifest = json.loads((site / "docs-publication.json").read_text())
            self.assertEqual(1234, manifest["qualified_run_id"])
            self.assertEqual("a" * 40, manifest["source_sha"])
            self.assertNotIn("viewer/index.html", manifest["files"])

    def test_staging_never_modifies_pages_workflow_definitions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = previous_site(root)
            verifier = site / ".github/workflows/pages-check.yml"
            original = verifier.read_bytes()
            stage(DOCS, artifact_fixture(root), site, "d" * 40, "15")
            self.assertEqual(original, verifier.read_bytes())

    def test_unprovisioned_workflow_blocks_staging_without_modification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = previous_site(root)
            verifier = site / ".github/workflows/pages-check.yml"
            verifier.write_text("obsolete verifier")
            with self.assertRaisesRegex(ValueError, "verifier"):
                stage(DOCS, artifact_fixture(root), site, "e" * 40, "15")
            self.assertEqual("obsolete verifier", verifier.read_text())
            self.assertTrue((site / "site.css").is_file())

    def test_published_asset_mutation_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            built = artifact_fixture(root)
            site = previous_site(root)
            stage(DOCS, built, site, "b" * 40, "10")
            (site / "assets/app.js").write_text("modified")
            with self.assertRaisesRegex(ValueError, "diverge"):
                check_published(DOCS, site)

    def test_unknown_pages_root_is_preserved_and_blocks_staging(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            site = previous_site(root)
            (site / "unowned.txt").write_text("keep")
            with self.assertRaisesRegex(ValueError, "unowned roots"):
                stage(DOCS, artifact_fixture(root), site, "c" * 40, "10")
            self.assertEqual("keep", (site / "unowned.txt").read_text())
            self.assertTrue((site / "site.css").is_file())

    def test_built_viewer_assets_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            built = artifact_fixture(root)
            (built / "viewer/index.html").write_text("not documentation")
            with self.assertRaisesRegex(ValueError, "viewer"):
                check(DOCS, built, published=False)

    def test_symlinked_publication_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            built = artifact_fixture(root)
            (built / "assets/escape.js").symlink_to("/etc/passwd")
            with self.assertRaisesRegex(ValueError, "Symlink|Unsafe"):
                check(DOCS, built, published=False)


if __name__ == "__main__":
    unittest.main()
