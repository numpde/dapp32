"""VitePress port: preserve public guide routes and immutable protocol resources."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import unittest
from urllib.parse import urljoin, urlsplit

from .common import ROOT


DOCS = ROOT / "docs"
PAGES = (
    "index.md",
    "start/index.md",
    "start/local-wallet.md",
    "start/fixture-wallet.md",
    "gallery/index.md",
    "use/index.md",
    "authoring/index.md",
    "authoring/headless.md",
    "development/index.md",
    "development/app-checks.md",
    "development/payment-fixture.md",
    "pay-to-play/index.md",
    "pay-to-play/integration.md",
    "pay-to-play/local-payment.md",
    "escrow/index.md",
    "escrow/documents.md",
    "escrow/reference.md",
    "bike-nft/index.md",
    "bike-nft/metadata.md",
    "bike-nft/ownership.md",
    "examples/index.md",
    "deployment/index.md",
    "deployment/new-instance.md",
    "deployment/update.md",
    "deployment/recovery.md",
    "deployment/practice.md",
    "deployment/source-verification.md",
    "deployment/manual.md",
    "deployment/pay-to-play/index.md",
    "deployment/escrow/index.md",
    "deployment/bike-nft/index.md",
    "deployment/networks/index.md",
    "deployment/rpc/index.md",
    "reference/index.md",
    "reference/operations.md",
    "reference/diagnostics.md",
    "reference/cam/index.md",
    "viewer/deploy.md",
)
REFERENCE_VERSIONS = ("1.1.0", "1.2.0", "1.3.0", "1.4.0")
BASE = "https://numpde.github.io/dapp32/"


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)


def route_for(page: str) -> str:
    if page.endswith("index.md"):
        return page.removesuffix("index.md")
    return page.removesuffix(".md") + ".html"


def local_source(relative_url: str) -> Path:
    if relative_url.endswith("/"):
        relative_url += "index.html"
    if relative_url.endswith(".html"):
        markdown = DOCS / (relative_url[:-5] + ".md")
        if markdown.is_file():
            return markdown
        return DOCS / relative_url
    return DOCS / "public" / relative_url


class DocsPortTests(unittest.TestCase):
    def test_all_published_guide_routes_are_owned_in_main(self) -> None:
        for page in PAGES:
            with self.subTest(page=page):
                source = DOCS / page
                self.assertTrue(source.is_file(), "missing migrated guide")
                content = source.read_text(encoding="utf-8")
                self.assertTrue(content.startswith("---\n"), "frontmatter required")
                self.assertRegex(content, r"(?m)^# \S")
                self.assertNotIn('class="topbar"', content)
                self.assertNotIn("theme.js", content)
                self.assertNotIn("site.css", content)

    def test_local_navigation_targets_are_present(self) -> None:
        for page in PAGES:
            content = (DOCS / page).read_text(encoding="utf-8")
            parser = Links()
            parser.feed(content)
            current = urljoin(BASE, route_for(page))
            for href in parser.links:
                url = urlsplit(urljoin(current, href))
                if (url.scheme, url.netloc) != ("https", "numpde.github.io"):
                    continue
                if not url.path.startswith("/dapp32/"):
                    continue
                relative = url.path.removeprefix("/dapp32/")
                if relative == "viewer/":
                    # The viewer preview is produced by its separate Pages CI.
                    continue
                source = local_source(relative)
                with self.subTest(page=page, href=href):
                    self.assertTrue(source.is_file(), f"link has no owned source: {source}")

    def test_versioned_cam_references_are_not_converted_or_duplicated(self) -> None:
        for version in REFERENCE_VERSIONS:
            with self.subTest(version=version):
                reference = DOCS / f"reference/cam/{version}/index.html"
                self.assertTrue(reference.is_file())
                self.assertTrue(reference.read_text(encoding="utf-8").startswith("<!doctype html>"))
                self.assertFalse(reference.with_suffix(".md").exists())
        compose = (ROOT / "compose/docs.yml").read_text(encoding="utf-8")
        self.assertIn("public/reference/cam", compose)
        self.assertIn('cp -a "/work/js/docs/reference/cam/$version"', compose)

    def test_gallery_uses_one_catalog_and_page_mounts(self) -> None:
        self.assertTrue((DOCS / "public/gallery/deployments.json").is_file())
        self.assertTrue((DOCS / "public/deployments/index.html").is_file())
        for page, script, mount in (
            ("gallery/index.md", "gallery/deployments.js", "mountGallery"),
            ("deployment/networks/index.md", "deployment/networks/networks.js", "mountNetworks"),
        ):
            with self.subTest(page=page):
                source = (DOCS / page).read_text(encoding="utf-8")
                implementation = (DOCS / script).read_text(encoding="utf-8")
                self.assertIn("onMounted(", source)
                self.assertIn("onBeforeUnmount(", source)
                self.assertRegex(implementation, rf"export (?:async )?function {mount}\(")
                # Gallery may be synchronous; the network catalog awaits fetch.
                self.assertTrue(mount in source)
