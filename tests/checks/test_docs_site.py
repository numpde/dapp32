"""Generated-site staging and independent-viewer preservation checks."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.docs_site import (check, check_published, stage, canonical_pages,
                             architecture_model, html_path, route_url, sidebar_links)

from .common import ROOT


DOCS = ROOT / "docs"


def artifact_fixture(root: Path) -> Path:
    artifact = root / "built"
    artifact.mkdir()
    pages, retired = canonical_pages(DOCS)
    home = architecture_model(DOCS)["home"]
    for original, canonical in pages:
        output = html_path(canonical)
        target = artifact / output
        target.parent.mkdir(parents=True, exist_ok=True)
        ids = ""
        if canonical == home["route"]:
            sections = architecture_model(DOCS)["sections"]
            cards = ''.join(
                '<section class="card home-section-card" data-section="' + section["id"] + '">'
                '<h2><a href="/dapp32/' + route_url(section["landing"]["route"]) + '">'
                + section["label"] + '</a></h2><p>' + section["summary"] + '</p></section>'
                for section in sections
            )
            ids = '<div class="grid two">' + cards + '</div>'
        if output == Path("gallery/index.html"):
            catalog = json.loads((DOCS / "public/gallery/deployments.json").read_text(encoding="utf-8"))
            apps = {item["appId"]: item["name"] for item in catalog["deployments"]}
            sidebar = "".join(f'<a href="/dapp32/gallery/#{app_id}">{name}</a>'
                              for app_id, name in apps.items())
            ids = ('<nav aria-label="Gallery sidebar">' + sidebar + '</nav>'
                   '<p id="load-status" class="gallery-status is-loading"'
                   ' role="status" aria-busy="true">Loading deployments…</p>'
                   '<button id="retry"></button><div id="deployments">'
                   '<div class="gallery-loading-card"></div></div>')
        if output == Path("deploy/networks/index.html"):
            ids = ''.join(f'<div id="{name}"></div>'
                          for name in ("load-status", "reference", "networks", "network-jump"))
        section = canonical.split("/", 1)[0] if canonical != home["route"] else None
        active_nav = ('<a class="VPNavBarMenuLink active" href="/dapp32/' + section + '/">Section</a>'
                      if section else '')
        breadcrumb = ('<nav aria-label="Breadcrumb"><a href="/dapp32/">Home</a></nav>'
                      if section and canonical != section + "/index.md" else '')
        sidebar = ('<aside class="VPSidebar">' +
                   ''.join(f'<a href="{href}">Page</a>' for href in sidebar_links(DOCS, section)) +
                   '</aside>')
        target.write_text("<!doctype html><html><body>" + active_nav + sidebar + breadcrumb
                          + ids + ("document " * 30) + "</body></html>", encoding="utf-8")
    for original, canonical in pages:
        if original == canonical:
            continue
        redirect = artifact / html_path(original)
        redirect.parent.mkdir(parents=True, exist_ok=True)
        redirect.write_text('<link rel="canonical" href="/dapp32/' + route_url(canonical) + '">')
    for original, destination in retired.items():
        redirect = artifact / html_path(original)
        redirect.parent.mkdir(parents=True, exist_ok=True)
        redirect.write_text('<link rel="canonical" href="/dapp32/' + destination + '">')
    for version in ("1.1.0", "1.2.0", "1.3.0", "1.4.0"):
        path = Path("reference/cam") / version / "index.html"
        destination = artifact / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(DOCS / path, destination)
    catalog = artifact / "gallery/deployments.json"
    catalog.write_bytes((DOCS / "public/gallery/deployments.json").read_bytes())
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

    def test_legacy_and_canonical_pages_have_exactly_one_target(self) -> None:
        pages, retired = canonical_pages(DOCS)
        self.assertEqual(len(pages), len({original for original, _ in pages}))
        self.assertEqual(1, len(retired))
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            check(DOCS, site, published=False)
            for old, new in pages:
                with self.subTest(old=old):
                    self.assertTrue((site / html_path(new)).is_file())
                    if old != new:
                        self.assertIn("/dapp32/" + route_url(new),
                                      (site / html_path(old)).read_text())

    def test_every_generated_guide_including_home_requires_a_sidebar(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            pages, _ = canonical_pages(DOCS)
            for _, route in pages:
                with self.subTest(page=route):
                    output = site / html_path(route)
                    self.assertIn('<aside class="VPSidebar">', output.read_text(encoding="utf-8"))
            check(DOCS, site, published=False)

        for route in ("index.md", "gallery/index.md", "use/pay-to-play/index.md"):
            with self.subTest(missing_sidebar_on=route), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                output = site / html_path(route)
                markup = output.read_text(encoding="utf-8")
                left = markup.index('<aside class="VPSidebar">')
                right = markup.index('</aside>', left) + len('</aside>')
                output.write_text(markup[:left] + markup[right:], encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Required sidebar is absent"):
                    check(DOCS, site, published=False)

    def test_home_sidebar_matches_the_six_declared_sections(self) -> None:
        sections = architecture_model(DOCS)["sections"]
        expected = ["/dapp32/" + route_url(section["landing"]["route"]) for section in sections]
        self.assertEqual(expected, sidebar_links(DOCS, None))
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            markup = (site / "index.html").read_text(encoding="utf-8")
            left = markup.index('<aside class="VPSidebar">')
            right = markup.index('</aside>', left)
            sidebar_markup = markup[left:right]
            self.assertEqual(6, sidebar_markup.count('<a href="/dapp32/'))
            for href in expected:
                self.assertIn(f'href="{href}"', sidebar_markup)
            check(DOCS, site, published=False)

    def test_sidebar_rejects_cross_section_duplicate_and_unlisted_links(self) -> None:
        for extra in ('<a href="/dapp32/use/">Cross-section</a>',
                      '<a href="/dapp32/gallery/#unlisted-app">Unknown app</a>',
                      '<a href="/dapp32/gallery/#bike-nft">Duplicate app</a>'):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                gallery = site / "gallery/index.html"
                gallery.write_text(gallery.read_text().replace("</aside>", extra + "</aside>"))
                with self.assertRaisesRegex(ValueError, "Sidebar contains"):
                    check(DOCS, site, published=False)

    def test_sidebar_rejects_missing_owned_guide(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            target = site / "use/pay-to-play/index.html"
            target.write_text(target.read_text().replace(
                '<a href="/dapp32/use/pay-to-play/">Page</a>', ''))
            with self.assertRaisesRegex(ValueError, "Sidebar contains"):
                check(DOCS, site, published=False)

    def test_home_directory_matches_all_six_section_definitions(self) -> None:
        sections = architecture_model(DOCS)["sections"]
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            html = (site / "index.html").read_text(encoding="utf-8")
            self.assertEqual(6, html.count('class="card home-section-card"'))
            for section in sections:
                self.assertIn('data-section="' + section["id"] + '"', html)
                self.assertIn('href="/dapp32/' + route_url(section["landing"]["route"]) + '"', html)
            check(DOCS, site, published=False)

    def test_home_directory_rejects_missing_duplicate_and_unowned_cards(self) -> None:
        sections = architecture_model(DOCS)["sections"]
        for name, change in (
            ("missing",
             lambda html: html.replace('data-section="gallery"', 'data-section="missing"')),
            ("duplicate",
             lambda html: html.replace('data-section="gallery"', 'data-section="start"')),
            ("wrong destination",
             lambda html: html.replace('href="/dapp32/gallery/"', 'href="/dapp32/use/"')),
            ("wrong label",
             lambda html: html.replace('>' + sections[0]["label"] + '</a>', '>Wrong section</a>')),
            ("wrong summary",
             lambda html: html.replace(sections[0]["summary"], "Mismatched section description")),
        ):
            with self.subTest(change=name), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                home = site / "index.html"
                altered = change(home.read_text(encoding="utf-8"))
                self.assertNotEqual(altered, home.read_text(encoding="utf-8"))
                home.write_text(altered, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Homepage"):
                    check(DOCS, site, published=False)

    def test_internal_links_and_anchors_are_validated(self) -> None:
        for href, error in (
            ("/dapp32/not-a-guide/", "Broken guide link"),
            ("/dapp32/authoring/", "old guide URL"),
            ("/dapp32/use/#nonexistent-section", "Broken section link"),
            ("/dapp32/gallery/#unlisted-app", "Broken section link"),
        ):
            with self.subTest(href=href), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                index = site / "index.html"
                html = index.read_text(encoding="utf-8")
                index.write_text(html.replace("</body>", f'<a href="{href}">Broken</a></body>'),
                                 encoding="utf-8")
                with self.assertRaisesRegex(ValueError, error):
                    check(DOCS, site, published=False)

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
