"""The Pages viewer publication only replaces the qualified application bundle."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.viewer_pages import check_bundle, stage_bundle


INDEX = """<!doctype html><html lang="en"><head>
<link rel="modulepreload" href="./assets/chunk-new.js">
<link rel="stylesheet" href="./assets/index-new.css">
</head><body><div id="root"></div>
<script type="module" src="./assets/index-new.js"></script></body></html>"""


class ViewerPagesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.qualified = root / "qualified"
        self.published = root / "site/viewer"
        (self.qualified / "assets").mkdir(parents=True)
        (self.published / "assets").mkdir(parents=True)
        (self.qualified / "index.html").write_text(INDEX, encoding="utf-8")
        (self.qualified / "assets/index-new.css").write_text("body { color: red }", encoding="utf-8")
        (self.qualified / "assets/index-new.js").write_text("export {}", encoding="utf-8")
        (self.qualified / "assets/chunk-new.js").write_text("export const chunk = 1", encoding="utf-8")
        (self.published / "index.html").write_text("old viewer", encoding="utf-8")
        (self.published / "assets/old.js").write_text("old asset", encoding="utf-8")
        (self.published / "deploy.html").write_bytes(b"immutable hosting guide")
        (self.published.parent / "index.html").write_bytes(b"immutable site homepage")

    def test_stage_replaces_only_application_assets_and_preserves_other_pages(self) -> None:
        entry = stage_bundle(self.qualified, self.published)
        self.assertEqual("./assets/index-new.js", entry)
        self.assertEqual(INDEX, (self.published / "index.html").read_text(encoding="utf-8"))
        self.assertEqual({"index-new.js", "chunk-new.js", "index-new.css"},
                         {path.name for path in (self.published / "assets").iterdir()})
        self.assertEqual(b"immutable hosting guide", (self.published / "deploy.html").read_bytes())
        self.assertEqual(b"immutable site homepage", (self.published.parent / "index.html").read_bytes())
        self.assertEqual(entry, check_bundle(self.published, guide=True))

    def test_rejects_artifact_entries_outside_the_viewer_contract(self) -> None:
        (self.qualified / "deploy.html").write_text("unexpected", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "only index.html and assets"):
            stage_bundle(self.qualified, self.published)
        self.assertEqual("old viewer", (self.published / "index.html").read_text(encoding="utf-8"))

    def test_rejects_missing_and_external_asset_references_without_modifying_pages(self) -> None:
        for index in (
            INDEX.replace("./assets/index-new.js", "./assets/missing.js"),
            INDEX.replace("./assets/index-new.js", "https://evil.example/script.js"),
            INDEX.replace("./assets/index-new.js", "../index.js"),
        ):
            with self.subTest(index=index):
                (self.qualified / "index.html").write_text(index, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "nonlocal assets"):
                    stage_bundle(self.qualified, self.published)
                self.assertEqual("old viewer", (self.published / "index.html").read_text(encoding="utf-8"))

    def test_rejects_symlinks_and_missing_published_guide(self) -> None:
        (self.qualified / "assets/index-new.js").unlink()
        (self.qualified / "assets/index-new.js").symlink_to("index-new.css")
        with self.assertRaisesRegex(ValueError, "regular files"):
            stage_bundle(self.qualified, self.published)
        (self.qualified / "assets/index-new.js").unlink()
        (self.qualified / "assets/index-new.js").write_text("export {}", encoding="utf-8")
        (self.published / "deploy.html").unlink()
        with self.assertRaisesRegex(ValueError, "guide"):
            stage_bundle(self.qualified, self.published)

    def test_rejects_missing_application_root_and_missing_stylesheet(self) -> None:
        (self.qualified / "index.html").write_text(INDEX.replace('id="root"', 'id="other"'), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "application root"):
            stage_bundle(self.qualified, self.published)
        (self.qualified / "index.html").write_text(INDEX.replace('<link rel="stylesheet" href="./assets/index-new.css">', ""), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "stylesheet"):
            stage_bundle(self.qualified, self.published)
