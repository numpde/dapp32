"""Static documentation orientation: one hierarchy, pre-rendered for zero layout shift.

The published HTML contains its breadcrumbs, section index and long-page contents.
No JavaScript is required to render or discover these navigation links.
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from html import escape, unescape
from pathlib import Path


# One authoritative hierarchy, used to render (and validate) the committed HTML.
# A group is (name, destination, ((path, title), ...)); a leaf is (path, title).
DOC_SECTIONS = (
    ("Start", "start/index.html", (
        ("start/index.html", "What runs where"),
        ("start/local-wallet.html", "Try Pay-to-Play locally"),
        ("start/fixture-wallet.html", "Connect the test wallet"),
        ("examples/index.html", "Local demos"),
    )),
    # Catalog-backed sections use their source data rather than another menu list.
    ("Gallery", "gallery/index.html", (
        ("gallery/index.html", "Gallery"),
    ), "gallery/deployments.json"),
    ("Use", "use/index.html", (
        ("use/index.html", "Use an app"),
        ("Pay-to-Play", "pay-to-play/index.html", (
            ("pay-to-play/index.html", "Pay-to-Play"),
            ("pay-to-play/local-payment.html", "Try a voucher payment"),
            ("pay-to-play/integration.html", "Integrate payments"),
        )),
        ("Escrow", "escrow/index.html", (
            ("escrow/index.html", "Escrow"),
            ("escrow/documents.html", "Prepare documents"),
            ("escrow/reference.html", "Contract behavior"),
        )),
        ("Bike NFT", "bike-nft/index.html", (
            ("bike-nft/index.html", "Bike NFT"),
            ("bike-nft/ownership.html", "Ownership and workshops"),
            ("bike-nft/metadata.html", "Metadata"),
        )),
    )),
    ("Build", "authoring/index.html", (
        ("authoring/index.html", "Build a workflow"),
        ("authoring/headless.html", "Headless integration"),
        ("development/index.html", "Source setup"),
        ("development/app-checks.html", "App checks"),
        ("development/payment-fixture.html", "Payment fixture"),
    )),
    ("Deploy", "deployment/index.html", (
        ("deployment/index.html", "Deploy"),
        ("deployment/new-instance.html", "Deploy a new instance"),
        ("viewer/deploy.html", "Host the stand-alone viewer"),
        ("deployment/update.html", "Update an instance"),
        ("deployment/recovery.html", "Recover a release"),
        ("deployment/source-verification.html", "Verify contract sources"),
        ("deployment/practice.html", "Rehearse a release"),
        ("App settings", "deployment/index.html#app-settings", (
            ("deployment/bike-nft/index.html", "Bike NFT settings"),
            ("deployment/escrow/index.html", "Escrow settings"),
            ("deployment/pay-to-play/index.html", "Pay-to-Play settings"),
        )),
        ("Older bookmarks", "deployment/index.html", (
            ("deployment/manual.html", "Legacy manual index"),
        )),
    )),
    ("Reference", "reference/index.html", (
        ("reference/index.html", "Reference"),
        ("reference/cam/index.html", "CAM specifications"),
        ("reference/operations.html", "Operational records"),
        ("reference/diagnostics.html", "Diagnostics"),
        ("deployment/networks/index.html", "Networks"),
        ("deployment/rpc/index.html", "RPC services"),
    )),
)


# Parent pages are explicit and independent of menu sections. Only record an
# actual content relationship: a menu category is not automatically a parent.
PAGE_PARENTS = {
    "start/fixture-wallet.html": "start/local-wallet.html",
    "pay-to-play/local-payment.html": "pay-to-play/index.html",
    "pay-to-play/integration.html": "pay-to-play/index.html",
    "escrow/documents.html": "escrow/index.html",
    "escrow/reference.html": "escrow/index.html",
    "bike-nft/ownership.html": "bike-nft/index.html",
    "bike-nft/metadata.html": "bike-nft/index.html",
    "development/app-checks.html": "development/index.html",
    "development/payment-fixture.html": "development/index.html",
    "deployment/new-instance.html": "deployment/index.html",
    "viewer/deploy.html": "deployment/index.html",
    "deployment/update.html": "deployment/index.html",
    "deployment/recovery.html": "deployment/index.html",
    "deployment/source-verification.html": "deployment/index.html",
    "deployment/practice.html": "deployment/index.html",
    "deployment/bike-nft/index.html": "deployment/index.html",
    "deployment/escrow/index.html": "deployment/index.html",
    "deployment/pay-to-play/index.html": "deployment/index.html",
    "deployment/manual.html": "deployment/index.html",
    "reference/cam/index.html": "reference/index.html",
    "reference/operations.html": "reference/index.html",
    "reference/diagnostics.html": "reference/index.html",
    "deployment/networks/index.html": "reference/index.html",
    "deployment/rpc/index.html": "reference/index.html",
}


def guide_locations() -> dict[str, tuple]:
    result = {}
    for section in DOC_SECTIONS:
        for item in section[2]:
            for leaf in (item[2] if len(item) == 3 else (item,)):
                path = leaf[0]
                if path in result:
                    raise AssertionError(f"guide declared twice: {path}")
                result[path] = (section, item if len(item) == 3 else None, leaf[1])
    for child, parent in PAGE_PARENTS.items():
        if child not in result or parent not in result:
            raise AssertionError(f"unknown page relationship: {child} -> {parent}")
    return result


def section_items(root: Path, section: tuple) -> tuple:
    """Add app links from a section's catalog instead of duplicating its entries."""
    if len(section) == 3:
        return section[2]
    catalog = json.loads((root / section[3]).read_text(encoding="utf-8"))
    releases = {}
    for deployment in catalog["deployments"]:
        key = deployment["appId"]
        previous = releases.get(key)
        if previous is None or deployment.get("deployedAt", "") > previous.get("deployedAt", ""):
            releases[key] = deployment
    links = tuple(
        (f'gallery/index.html#{deployment["id"]}', deployment["name"])
        for deployment in releases.values()
    )
    return (*section[2], *links)

def guide_url(root: Path, page: Path, destination: str) -> str:
    pathname, _, fragment = destination.partition("#")
    if not pathname:
        return "#" + fragment
    target = root / pathname
    target = target.parent if pathname.endswith("/index.html") else target
    href = os.path.relpath(target, page.parent).replace(os.sep, "/")
    if pathname.endswith("/index.html"):
        href = href.rstrip("/") + "/" if href != "." else "./"
    return href + ("#" + fragment if fragment else "")


def guide_link(root: Path, page: Path, destination: str, title: str, active=False) -> str:
    current = ' aria-current="page"' if active else ""
    return f'<a href="{escape(guide_url(root, page, destination), quote=True)}"{current}>{escape(title)}</a>'


def guide_html(root: Path, page: Path, source: str) -> str:
    """Produce complete guide layout before first paint; never shift it in JavaScript."""
    # Accept previously generated markup and re-render it idempotently.
    source = re.sub(r'<!-- docs-layout:start -->.*?<!-- docs-layout:before-main -->\n', '', source, flags=re.DOTALL)
    source = re.sub(r'\n<!-- docs-layout:after-main -->\n</div>\n<!-- docs-layout:end -->', '', source)
    path = page.relative_to(root).as_posix()
    record = guide_locations().get(path)
    if record is None:
        return source
    section, group, page_label = record
    main = re.search(r'<main\s+id="main"(?:\s+class="[^"]*")?>', source)
    ending = list(re.finditer(r'</main>', source))
    if main is None or len(ending) != 1:
        raise AssertionError(f"guide needs exactly one main landmark: {page}")
    end = ending[0]
    article = re.search(r'<article\s+class="narrow">(.*?)</article>', source[main.end():end.start()], flags=re.DOTALL)
    original_classes = re.search(r'\bclass="([^"]*)"', main.group(0))
    classes_before = original_classes.group(1).split() if original_classes else []
    # Document-styled pages use the ordinary content width even without an article.
    # Wide references omit document styling.
    wide = article is None and "document" not in classes_before
    title_source = article.group(1) if article else source[main.end():end.start()]
    h1 = re.search(r'<h1(?:\s+[^>]*)?>(.*?)</h1>', title_source, flags=re.DOTALL)
    if h1 is None:
        raise AssertionError(f"guide needs a title: {page}")
    title = unescape(re.sub(r'<[^>]*>', '', h1.group(1))).strip()
    section_name, section_root = section[:2]
    items = section_items(root, section)
    # Menu grouping and breadcrumb ancestry are separate concepts. An actual
    # parent must be a page, not an invented category or a group heading.
    locations = guide_locations()
    lineage, visited = [], {path}
    parent = PAGE_PARENTS.get(path)
    while parent is not None:
        if parent in visited:
            raise AssertionError(f"circular breadcrumb ancestry at {path}")
        visited.add(parent)
        lineage.append(parent)
        parent = PAGE_PARENTS.get(parent)
    trail = [guide_link(root, page, "index.html", "Home")]
    for ancestor in reversed(lineage):
        trail.append(guide_link(root, page, ancestor, locations[ancestor][2]))
    trail.append(f'<span aria-current="page">{escape(page_label)}</span>')
    crumb = '<nav class="docs-breadcrumb shell" aria-label="Breadcrumb"><ol>' + ''.join(f'<li>{item}</li>' for item in trail) + '</ol></nav>'
    section_links = []
    for item in items:
        if len(item) == 2:
            section_links.append(guide_link(root, page, item[0], item[1], item[0] == path))
        else:
            name, _, leaves = item
            active = any(child_path == path for child_path, _ in leaves)
            children = ''.join(guide_link(root, page, p, label, p == path) for p, label in leaves)
            section_links.append(f'<details class="docs-subsection"{" open" if active else ""}><summary>{escape(name)}</summary><div class="docs-subsection-links">{children}</div></details>')
    rail = f'<aside class="docs-rail" aria-label="Documentation navigation"><details class="docs-section"><summary>In {escape(section_name)}</summary><nav class="docs-section-links" aria-label="In {escape(section_name)}">' + ''.join(section_links) + '</nav></details>'

    # Contents are for long leaf guides only; pages with authored contents keep them.
    article_source = article.group(1) if article else ''
    has_authored_contents = any(
        re.search(r'\bhref="#', match.group(0))
        for match in re.finditer(r'<nav\b[^>]*>.*?</nav>', article_source, flags=re.DOTALL)
    )
    toc = []
    if article and path != section_root and not path.endswith('/manual.html') and not has_authored_contents:
        heading_re = re.compile(r'<h2(\s+[^>]*)?>(.*?)</h2>', re.DOTALL)
        headings = list(heading_re.finditer(article_source))
        if len(headings) >= 4:
            known_ids = set(re.findall(r'\bid="([^"]+)"', source))
            def add_heading_id(m):
                attrs, html = m.group(1) or '', m.group(2)
                match = re.search(r'\bid="([^"]+)"', attrs)
                label = unescape(re.sub(r'<[^>]*>', '', html)).strip()
                if match:
                    identifier = match.group(1)
                else:
                    stem = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', label).lower()).strip('-')[:64] or 'section'
                    identifier = stem
                    n = 2
                    while identifier in known_ids:
                        identifier = f'{stem}-{n}'
                        n += 1
                    known_ids.add(identifier)
                    attrs += f' id="{identifier}"'
                toc.append((identifier, label))
                return f'<h2{attrs}>{html}</h2>'
            updated_article = heading_re.sub(add_heading_id, article_source)
            source = source[:main.end()] + source[main.end():end.start()].replace(article_source, updated_article, 1) + source[end.start():]
            # The insertion shifts the end offset; re-scan before wrapping main.
            main = re.search(r'<main\s+id="main"(?:\s+class="[^"]*")?>', source)
            end = re.search(r'</main>', source[main.end():])
            if end is None:
                raise AssertionError(f"lost main closing tag: {page}")
            end_position = main.end() + end.start()
            links = ''.join(guide_link(root, page, f'#{identifier}', label) for identifier, label in toc)
            rail += '<details class="docs-toc"><summary>On this page</summary><nav aria-label="On this page">' + links + '</nav></details>'
        else:
            end_position = end.start()
    else:
        end_position = end.start()
    rail += '</aside>'
    # Nav first in the source, so it is present on the very first layout pass.
    classes = 'docs-main docs-wide' if wide else 'document docs-main'
    frame = 'docs-layout shell docs-layout-wide' if wide else 'docs-layout shell'
    before = '<!-- docs-layout:start -->\n' + crumb + '\n<div class="' + frame + '">\n' + rail + '\n<!-- docs-layout:before-main -->\n'
    after = '\n<!-- docs-layout:after-main -->\n</div>\n<!-- docs-layout:end -->'
    # Keep each page's content classes, but not duplicate frame/shell classes.
    retained = [name for name in classes_before if name not in
                {"shell", "document", "docs-main", "docs-wide"}]
    class_names = " ".join((classes, *retained))
    new_open = f'<main id="main" class="{class_names}">'
    return source[:main.start()] + before + new_open + source[main.end():end_position] + '</main>' + after + source[end_position + len('</main>'):]
