"""Generated-site staging and independent-viewer preservation checks."""
from __future__ import annotations

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from tools.docs_site import (check, check_published, stage, canonical_pages,
                             architecture_model, reference_versions,
                             html_path, route_url, sidebar_links)

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
    for version in reference_versions(DOCS):
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

    def test_generated_pages_reject_missing_sidebars(self) -> None:
        pages, _ = canonical_pages(DOCS)
        # Exercise root, a section landing and a nested guide. The generated
        # site validator itself iterates over every canonical page.
        samples = [pages[0][1], pages[1][1], pages[-1][1]]
        for route in samples:
            with self.subTest(route=route), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                output = site / html_path(route)
                markup = output.read_text(encoding="utf-8")
                left = markup.index('<aside class="VPSidebar">')
                right = markup.index("</aside>", left) + len("</aside>")
                output.write_text(markup[:left] + markup[right:], encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Required sidebar is absent"):
                    check(DOCS, site, published=False)

    def test_sidebar_rejects_unowned_or_duplicate_destinations(self) -> None:
        sections = architecture_model(DOCS)["sections"]
        catalog = next(section for section in sections
                       if any(group["kind"] == "catalog" for group in section["groups"]))
        other = next(section for section in sections if section is not catalog)
        existing = sidebar_links(DOCS, catalog["id"])[0]
        invalid = (
            "/dapp32/" + route_url(other["landing"]["route"]),
            "/dapp32/" + route_url(catalog["landing"]["route"]) + "#not-in-catalog",
            existing,
        )
        for href in invalid:
            with self.subTest(href=href), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                page = site / html_path(catalog["landing"]["route"])
                markup = page.read_text(encoding="utf-8")
                page.write_text(markup.replace("</aside>", f'<a href="{href}">Extra</a></aside>'),
                                encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Sidebar contains"):
                    check(DOCS, site, published=False)

    def test_sidebar_rejects_missing_owned_guide(self) -> None:
        section = next(section for section in architecture_model(DOCS)["sections"]
                       if any(group["kind"] == "pages" for group in section["groups"]))
        link = sidebar_links(DOCS, section["id"])[0]
        with tempfile.TemporaryDirectory() as directory:
            site = artifact_fixture(Path(directory))
            page = site / html_path(section["landing"]["route"])
            original = page.read_text(encoding="utf-8")
            omission = f'<a href="{link}">Page</a>'
            self.assertIn(omission, original)
            page.write_text(original.replace(omission, "", 1), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "Sidebar contains"):
                check(DOCS, site, published=False)

    def test_home_directory_rejects_cards_that_disagree_with_the_inventory(self) -> None:
        first, second = architecture_model(DOCS)["sections"][:2]
        first_url = "/dapp32/" + route_url(first["landing"]["route"])
        second_url = "/dapp32/" + route_url(second["landing"]["route"])
        changes = (
            ('data-section="' + second["id"] + '"', 'data-section="unowned-section"'),
            ('data-section="' + second["id"] + '"', 'data-section="' + first["id"] + '"'),
            ('<h2><a href="' + second_url + '"', '<h2><a href="' + first_url + '"'),
            (first["summary"], "Wrong summary"),
        )
        for before, after in changes:
            with self.subTest(replaced=before), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                page = site / "index.html"
                content = page.read_text(encoding="utf-8")
                self.assertIn(before, content)
                page.write_text(content.replace(before, after, 1), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Homepage"):
                    check(DOCS, site, published=False)

    def test_generated_internal_links_reject_missing_targets_and_obsolete_routes(self) -> None:
        pages, _ = canonical_pages(DOCS)
        old, _ = next(pair for pair in pages if pair[0] != pair[1])
        section = architecture_model(DOCS)["sections"][0]
        catalog_section = next(item for item in architecture_model(DOCS)["sections"]
                               if any(group["kind"] == "catalog" for group in item["groups"]))
        targets = (
            ("/dapp32/does-not-exist/", "Broken guide link"),
            ("/dapp32/" + route_url(old), "old guide URL"),
            ("/dapp32/" + route_url(section["landing"]["route"]) + "#nonexistent-anchor",
             "Broken section link"),
            ("/dapp32/" + route_url(catalog_section["landing"]["route"]) + "#unknown-app",
             "Broken section link"),
        )
        for href, error in targets:
            with self.subTest(href=href), tempfile.TemporaryDirectory() as directory:
                site = artifact_fixture(Path(directory))
                page = site / "index.html"
                markup = page.read_text(encoding="utf-8")
                page.write_text(markup.replace("</body>", f'<a href="{href}">Bad</a></body>'),
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
