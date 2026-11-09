"""Render optional breadcrumbs into the published HTML.

The top menu and article links are the main navigation. Only pages with real
parents get breadcrumbs; no sidebar, client-side reflow, or duplicate sitemap.
"""

from __future__ import annotations

import os
import re
from html import escape, unescape
from pathlib import Path


# Real content relationships, independent of the top-menu categories.
PARENTS = {
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


def title(page: Path) -> str:
    """Use the parent page's own title, never a second navigation label."""
    match = re.search(r"<title>(.*?)</title>", page.read_text(encoding="utf-8"), re.DOTALL)
    if match is None:
        raise AssertionError(f"missing parent-page title: {page}")
    return unescape(match.group(1)).split(" · dapp32", 1)[0].strip()


def breadcrumb(root: Path, page: Path) -> str:
    path = page.relative_to(root).as_posix()
    if path not in PARENTS:
        return ""
    ancestors, seen = [], {path}
    parent = PARENTS.get(path)
    while parent:
        if parent in seen or not (root / parent).is_file():
            raise AssertionError(f"invalid breadcrumb ancestry: {path} -> {parent}")
        seen.add(parent)
        ancestors.insert(0, parent)
        parent = PARENTS.get(parent)
    links = [(root / "index.html", "Home"), *[(root / path, title(root / path)) for path in ancestors]]
    parts = []
    for target, label in links:
        destination = target.parent if target.name == "index.html" else target
        href = os.path.relpath(destination, page.parent).replace(os.sep, "/")
        if target.name == "index.html":
            href = "./" if href == "." else href.rstrip("/") + "/"
        parts.append(f'<li><a href="{escape(href, quote=True)}">{escape(label)}</a></li>')
    return '<nav class="docs-breadcrumb shell" aria-label="Breadcrumb"><ol>' + ''.join(parts) + '</ol></nav>\n'


def render(root: Path, page: Path, html: str) -> str:
    """Remove the old sidebar frame and render only useful parent links."""
    html = re.sub(r'<!-- docs-layout:start -->.*?<!-- docs-layout:before-main -->\s*',
                  '', html, flags=re.DOTALL)
    html = re.sub(r'\s*<!-- docs-layout:after-main -->\s*</div>\s*<!-- docs-layout:end -->',
                  '', html)
    html = re.sub(r'<nav class="docs-breadcrumb shell" aria-label="Breadcrumb">.*?</nav>\s*',
                  '', html, flags=re.DOTALL)
    opening = re.search(r'<main id="main"(?: class="([^"]*)")?>', html)
    if opening is None or html.count('</main>') != 1:
        raise AssertionError(f"expected one main landmark: {page}")
    old_classes = (opening.group(1) or "").split()
    if "docs-wide" in old_classes or not old_classes:
        new_open = '<main id="main">'  # The network table retains its own width.
    else:
        classes = ["shell", "document", *(
            name for name in old_classes
            if name not in {"shell", "document", "docs-main", "docs-wide"}
        )]
        new_open = '<main id="main" class="' + ' '.join(classes) + '">'
    return html[:opening.start()] + breadcrumb(root, page) + new_open + html[opening.end():]
