"""The information architecture is the sole owner of guides and sidebar scope."""

from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import unittest

from tools.docs_site import canonical_pages, catalog_apps, html_path, route_url, sidebar_links
from .common import ROOT


DOCS = ROOT / "docs"
ARCHITECTURE = DOCS / ".vitepress/architecture.json"


class DocsNavigationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.architecture = json.loads(ARCHITECTURE.read_text(encoding="utf-8"))

    def test_six_sections_have_one_landing_and_only_local_sidebar_destinations(self) -> None:
        model = self.architecture
        self.assertEqual(3, model["version"])
        self.assertEqual({"source": "index.md", "route": "index.md", "text": "Home"}, model["home"])
        self.assertEqual(
            ["start", "gallery", "use", "build", "deploy", "reference"],
            [section["id"] for section in model["sections"]],
        )
        for section in model["sections"]:
            section_id = section["id"]
            with self.subTest(section=section_id):
                self.assertEqual(section_id + "/index.md", section["landing"]["route"])
                self.assertNotIn(
                    section["landing"]["source"],
                    [page["source"] for group in section["groups"]
                     for page in group.get("pages", [])],
                )
                self.assertTrue(section["groups"])
                self.assertIsInstance(section["summary"], str)
                self.assertTrue(section["summary"].strip())
                for link in sidebar_links(DOCS, section_id):
                    self.assertTrue(link.startswith("/dapp32/" + section_id + "/"), link)
                for group in section["groups"]:
                    self.assertIn(group["kind"], ("pages", "catalog"))
                    if group["kind"] == "pages":
                        for page in group["pages"]:
                            self.assertTrue(page["route"].startswith(section_id + "/"))
                        if group.get("parent"):
                            self.assertIn(group["parent"], {page["source"] for page in group["pages"]})

    def test_every_authored_guide_has_exactly_one_canonical_home(self) -> None:
        pages, retired = canonical_pages(DOCS)
        self.assertEqual({"deployment/manual.md": "deploy/"}, retired)
        self.assertEqual(len(pages), len({source for source, _ in pages}))
        self.assertEqual(len(pages), len({route for _, route in pages}))
        self.assertEqual(
            {path.relative_to(DOCS).as_posix() for path in DOCS.rglob("*.md")},
            {source for source, _ in pages} | set(retired),
        )

    def test_home_sidebar_is_the_six_section_landings_from_the_same_inventory(self) -> None:
        expected = [
            "/dapp32/" + route_url(section["landing"]["route"])
            for section in self.architecture["sections"]
        ]
        self.assertEqual(expected, sidebar_links(DOCS, None))
        self.assertEqual(6, len(expected))
        navigation = (DOCS / ".vitepress/navigation.ts").read_text(encoding="utf-8")
        self.assertIn("if (route === homePage.route) return '/'", navigation)
        self.assertIn("[homeHref, homeSections.map(section =>", navigation)
        self.assertIn("...sections.map(section => [", navigation)
        self.assertNotIn("sidebar['/']", navigation)

    def test_gallery_collection_has_no_handwritten_sidebar_links(self) -> None:
        section = next(item for item in self.architecture["sections"] if item["id"] == "gallery")
        self.assertEqual([{
            "kind": "catalog",
            "title": "Deployed applications",
            "catalog": "gallery/deployments.json",
            "anchor": "appId",
        }], section["groups"])
        items = catalog_apps(DOCS, "gallery/deployments.json")
        self.assertEqual(
            ["/dapp32/gallery/#" + app_id for app_id, _ in items],
            sidebar_links(DOCS, "gallery"),
        )
        self.assertNotIn("/dapp32/gallery/", sidebar_links(DOCS, "gallery"))
        self.assertNotIn("/dapp32/use/", sidebar_links(DOCS, "gallery"))

    def test_catalog_and_sidebar_ownership_violations_fail_closed(self) -> None:
        for name, change, error in (
            ("missing home", lambda m: m.pop("home"), "architecture schema version 3"),
            ("wrong home route", lambda m: m["home"].update(route="start/index.md"),
             "Site root must declare"),
            ("home duplicates a section", lambda m: m["home"].update(
                source="start/index.md", route="index.md"), "Site root must declare"),
            ("missing homepage summary", lambda m: m["sections"][0].pop("summary"),
             "Section must have"),
            ("cross-section page",
             lambda m: m["sections"][0]["groups"][0]["pages"][0].update(route="use/wrong.md"),
             "Duplicate or misplaced"),
            ("duplicate landing",
             lambda m: m["sections"][0]["groups"][0]["pages"].append(
                 deepcopy(m["sections"][0]["landing"])), "Duplicate or misplaced"),
            ("handwritten gallery link",
             lambda m: m["sections"][1]["groups"][0].update(
                 links=[{"text": "Use", "href": "/use/"}]), "Invalid catalog"),
            ("catalog in unrelated section",
             lambda m: m["sections"][2]["groups"].append(
                 deepcopy(m["sections"][1]["groups"][0])), "Invalid catalog"),
            ("unknown group kind",
             lambda m: m["sections"][3]["groups"][0].update(kind="external"),
             "Invalid sidebar"),
            ("section landing repeated",
             lambda m: m["sections"][4]["groups"][0]["pages"].append(
                 deepcopy(m["sections"][4]["landing"])), "Duplicate or misplaced"),
        ):
            model = deepcopy(self.architecture)
            change(model)
            with self.subTest(change=name), self.assertRaisesRegex(ValueError, error):
                canonical_pages(DOCS, definition=model)

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
        self.assertEqual(len(pages), len(canonical))
        self.assertIn(Path("index.html"), canonical)
        self.assertTrue(all(route_url(page).startswith(("start/", "gallery/", "use/",
                                                         "build/", "deploy/", "reference/"))
                            for _, page in pages if page != self.architecture["home"]["route"]))

    def test_all_ui_surfaces_use_one_navigation_projection(self) -> None:
        config = (DOCS / ".vitepress/config.mts").read_text(encoding="utf-8")
        navigation = (DOCS / ".vitepress/navigation.ts").read_text(encoding="utf-8")
        breadcrumbs = (DOCS / ".vitepress/theme/Breadcrumbs.vue").read_text(encoding="utf-8")
        prepare = (DOCS / ".vitepress/prepare-navigation.mjs").read_text(encoding="utf-8")
        compose = (ROOT / "compose/docs.yml").read_text(encoding="utf-8")
        gallery = (DOCS / "gallery/index.md").read_text(encoding="utf-8")

        self.assertIn("import { nav, sidebar, rewrites } from './navigation'", config)
        self.assertNotIn("sidebar['/gallery/']", config)
        self.assertNotIn("galleryCatalog", config)
        self.assertIn("import architecture from './architecture.json'", navigation)
        self.assertIn("import deploymentCatalog from '../public/gallery/deployments.json'", navigation)
        self.assertIn("section.landing", navigation)
        self.assertIn("export const homePage = architecture.home", navigation)
        self.assertIn("export const homeSections = sections.map(", navigation)
        self.assertIn("homePage, ...sections.flatMap(", navigation)
        self.assertIn("{ text: homePage.text, href: homeHref }", navigation)
        self.assertIn("group.kind === 'catalog'", navigation)
        self.assertIn("export function breadcrumbsFor(", navigation)
        self.assertIn("import { breadcrumbsFor } from '../navigation'", breadcrumbs)
        self.assertNotIn("architecture.json", breadcrumbs)
        self.assertIn("section.landing", prepare)
        self.assertIn("ownPage(home, null)", prepare)
        self.assertIn("const pages = [home, ...sections.flatMap(", prepare)
        self.assertIn("architecture.json", prepare)
        self.assertIn("prepare-navigation.mjs /work/js/docs", compose)
        homepage = (DOCS / "index.md").read_text(encoding="utf-8")
        component = (DOCS / ".vitepress/theme/HomeSections.vue").read_text(encoding="utf-8")
        self.assertIn("import HomeSections from './.vitepress/theme/HomeSections.vue'", homepage)
        self.assertIn("<HomeSections />", homepage)
        self.assertNotIn('<div class="grid two">', homepage)
        self.assertIn("homeSections } from '../navigation'", component)
        self.assertIn("v-for=\"section in homeSections\"", component)
        self.assertIn("Related tasks:", gallery)
        for destination in ("../use/", "../examples/", "../deployment/networks/"):
            self.assertIn(destination, gallery)


if __name__ == "__main__":
    unittest.main()
