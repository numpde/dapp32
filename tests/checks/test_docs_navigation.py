"""The documentation menu, routes, breadcrumbs and redirects share one owner."""
from __future__ import annotations

import json
from pathlib import Path
import unittest

from tools.docs_site import canonical_pages, html_path, route_url
from .common import ROOT


DOCS = ROOT / "docs"
ARCHITECTURE = DOCS / ".vitepress/architecture.json"


class DocsNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.architecture = json.loads(ARCHITECTURE.read_text(encoding="utf-8"))

    def test_exactly_six_top_level_destinations_with_real_entry_pages(self) -> None:
        sections = self.architecture["sections"]
        self.assertEqual(
            ["start", "gallery", "use", "build", "deploy", "reference"],
            [section["id"] for section in sections],
        )
        for section in sections:
            with self.subTest(section=section["id"]):
                members = [page for group in section["groups"] for page in group["pages"]]
                self.assertEqual(1, sum(page["route"] == section["id"] + "/index.md"
                                        for page in members))

    def test_every_authored_guide_has_one_canonical_home(self) -> None:
        pages, retired = canonical_pages(DOCS)
        self.assertEqual(36, len(pages))
        self.assertEqual({"deployment/manual.md": "deploy/"}, retired)
        self.assertEqual(36, len({source for source, _ in pages}))
        self.assertEqual(36, len({target for _, target in pages}))
        self.assertEqual(
            {path.relative_to(DOCS).as_posix() for path in DOCS.rglob("*.md")},
            {"index.md"} | {source for source, _ in pages} | set(retired),
        )

    def test_groups_do_not_invent_breadcrumb_parent_pages(self) -> None:
        pages = {page["source"]: page for section in self.architecture["sections"]
                 for group in section["groups"] for page in group["pages"]}
        for section in self.architecture["sections"]:
            for group in section["groups"]:
                parent = group.get("parent")
                if not parent:
                    continue
                with self.subTest(parent=parent):
                    self.assertIn(parent, pages)
                    self.assertIn(parent, {page["source"] for page in group["pages"]})
                    self.assertTrue(pages[parent]["route"].startswith(section["id"] + "/"))

    def test_distinct_user_tasks_live_in_distinct_sections(self) -> None:
        pages = dict(canonical_pages(DOCS)[0])
        expected = {
            "examples/index.md": "start/examples/index.md",
            "pay-to-play/index.md": "use/pay-to-play/index.md",
            "escrow/documents.md": "use/escrow/documents.md",
            "bike-nft/ownership.md": "use/bike-nft/ownership.md",
            "authoring/index.md": "build/index.md",
            "development/index.md": "build/setup.md",
            "pay-to-play/integration.md": "build/pay-to-play-integration.md",
            "deployment/index.md": "deploy/index.md",
            "viewer/deploy.md": "deploy/viewer.md",
            "deployment/networks/index.md": "deploy/networks/index.md",
            "escrow/reference.md": "reference/escrow.md",
            "reference/cam/index.md": "reference/cam/index.md",
        }
        for source, target in expected.items():
            with self.subTest(page=source):
                self.assertEqual(target, pages[source])

    def test_legacy_routes_are_distinct_from_canonical_routes(self) -> None:
        pages, retired = canonical_pages(DOCS)
        canonical = {html_path(target) for _, target in pages}
        aliases = {html_path(source) for source, target in pages if source != target}
        aliases |= {html_path(source) for source in retired}
        self.assertFalse(canonical & aliases)
        self.assertEqual(1 + len(pages), len(canonical | {Path("index.html")}))
        self.assertTrue(all(route_url(page).startswith(("start/", "gallery/", "use/",
                                                         "build/", "deploy/", "reference/"))
                            for _, page in pages))

    def test_default_theme_uses_inventory_without_a_second_menu(self) -> None:
        config = (DOCS / ".vitepress/config.mts").read_text(encoding="utf-8")
        theme = (DOCS / ".vitepress/theme/index.ts").read_text(encoding="utf-8")
        breadcrumbs = (DOCS / ".vitepress/theme/Breadcrumbs.vue").read_text(encoding="utf-8")
        prepare = (DOCS / ".vitepress/prepare-navigation.mjs").read_text(encoding="utf-8")
        compose = (ROOT / "compose/docs.yml").read_text(encoding="utf-8")

        self.assertIn("import architecture from './architecture.json'", config)
        self.assertIn("rewrites,", config)
        self.assertIn("nav,", config)
        self.assertIn("sidebar,", config)
        self.assertIn("sections.map(section => [", config)
        self.assertNotIn("sections.filter(section => section.id !== 'gallery')", config)
        self.assertIn("sidebar['/gallery/'] = [", config)
        self.assertNotIn("sidebar['/gallery/'].push(", config)
        gallery_sidebar = config.split("sidebar['/gallery/'] = [", 1)[1].split("]\n", 1)[0]
        self.assertNotIn("collapsed:", gallery_sidebar)
        self.assertNotIn("items:", gallery_sidebar)
        self.assertIn("import galleryCatalog from '../public/gallery/deployments.json'", config)
        self.assertIn("link: '/gallery/#' + id", config)
        self.assertIn("activeMatch: '^/' + section.id + '/'", config)
        self.assertIn("item.route === source", breadcrumbs)
        self.assertNotIn("theme.js", theme)
        self.assertIn("DefaultTheme.Layout", theme)
        self.assertIn("aria-label=\"Breadcrumb\"", breadcrumbs)
        self.assertIn("architecture.json", breadcrumbs)
        self.assertIn("architecture.json", prepare)
        self.assertIn("location.replace(", prepare)
        self.assertIn("prepare-navigation.mjs /work/js/docs", compose)


if __name__ == "__main__":
    unittest.main()
