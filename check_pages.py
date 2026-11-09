from __future__ import annotations

import json
import os
import subprocess
from html.parser import HTMLParser
from pathlib import Path


SOURCE_ARCHIVE_ROOT: Path | None = None

# The published pages keep static, usable links; this is their single source.
PRIMARY_NAVIGATION = (
    ("start/", "Start"),
    ("gallery/", "Gallery"),
    ("use/", "Use"),
    ("authoring/", "Build"),
    ("deployment/", "Deploy"),
    ("reference/", "Reference"),
)


def navigation_pages(root: Path):
    import re

    for page in sorted(root.rglob("*.html")):
        relative = page.relative_to(root)
        if relative in {Path("viewer/index.html"), Path("deployments/index.html")}:
            continue  # Compiled app or legacy redirect, neither has the documentation shell.
        if relative.parent.parent == Path("reference/cam") and re.fullmatch(r"\d+\.\d+\.\d+", relative.parent.name):
            continue  # Versioned protocol documents are immutable copied resources.
        yield page


def shell_html(root: Path, page: Path) -> str:
    prefix = os.path.relpath(root, page.parent)
    links = []
    for destination, label in PRIMARY_NAVIGATION:
        current = page == root / destination / "index.html"
        href = "./" if current else f"{prefix}/{destination}"
        attribute = ' aria-current="page"' if current else ""
        links.append(f'<a href="{href}"{attribute}>{label}</a>')
    return (
        '<a class="skip-link" href="#main">Skip to content</a>\n'
        '<div class="topbar"><div class="shell">'
        f'<a class="brand" href="{prefix}/">dapp32</a>'
        '<nav aria-label="Primary">' + "".join(links) + '</nav>'
        '<button class="theme-toggle" id="theme-toggle" type="button" hidden aria-label="Toggle color theme">'
        '<span class="theme-sun" aria-hidden="true">☀</span>'
        '<span class="theme-moon" aria-hidden="true">☾</span>'
        '</button></div></div>'
    )


def theme_script(root: Path, page: Path) -> str:
    return f'<script src="{os.path.relpath(root, page.parent)}/theme.js"></script>'


def shell_updates(root: Path):
    import re

    pattern = re.compile(r'(<body[^>]*>)\s*(?:<a class="skip-link".*?</a>\s*)?<div class="topbar">.*?</div>\s*</div>', re.DOTALL)
    for page in navigation_pages(root):
        text = page.read_text(encoding="utf-8")
        matches = list(pattern.finditer(text))
        if len(matches) != 1:
            raise AssertionError(f"expected one shared site header: {page}")
        match = matches[0]
        expected = match[1] + "\n" + shell_html(root, page)
        updated = text[:match.start()] + expected + text[match.end():]
        updated = re.sub(r'<script src="[^"]*theme\.js"></script>\s*', '', updated)
        updated = re.sub(r'<script defer src="[^"]*docs-nav\.js"></script>\s*', '', updated)
        styles = list(re.finditer(r'<link rel="stylesheet" href="[^"]*site\.css">', updated))
        if len(styles) != 1:
            raise AssertionError(f"expected one shared stylesheet: {page}")
        style = styles[0]
        prefix = os.path.relpath(root, page.parent)
        resources = theme_script(root, page) + f'\n<script defer src="{prefix}/docs-nav.js"></script>' + f'\n<link rel="stylesheet" href="{prefix}/site.css">'
        updated = updated[:style.start()] + resources + updated[style.end():]
        if updated != text:
            yield page, updated


def check_navigation(root: Path) -> None:
    import re

    stale = [str(page.relative_to(root)) for page, _ in shell_updates(root)]
    if stale:
        raise AssertionError(f"site header differs; run make pages/navigation/update: {', '.join(stale)}")
    for page in navigation_pages(root):
        text = page.read_text(encoding="utf-8")
        scripts = re.findall(r'<script\b[^>]*>.*?</script>', text, re.DOTALL)
        expected = theme_script(root, page)
        if scripts.count(expected) != 1 or text.index(expected) > text.index('rel="stylesheet"'):
            raise AssertionError(f"expected one blocking shared theme script before styles: {page}")
        nav_script = f'<script defer src="{os.path.relpath(root, page.parent)}/docs-nav.js"></script>'
        if scripts.count(nav_script) != 1 or text.index(nav_script) > text.index('rel="stylesheet"'):
            raise AssertionError(f"expected one shared progressive docs navigation script: {page}")
        if any('dapp32-theme' in script for script in scripts):
            raise AssertionError(f"inline theme implementation duplicates theme.js: {page}")
        for style in re.findall(r'<style\b[^>]*>(.*?)</style>', text, re.DOTALL):
            if re.search(r'\.topbar\b|\.theme-toggle\b|:root\b|(?:^|[{}])\s*(?:body|a|nav)\s*[:{,]', style):
                raise AssertionError(f"shared site styles must be owned by site.css: {page}")


def check_shell_witnesses() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        page = root / "index.html"
        canonical = '<head>' + theme_script(root, page) + '\n<script defer src="./docs-nav.js"></script>\n<link rel="stylesheet" href="./site.css"></head><body>\n' + shell_html(root, page) + '<main id="main"></main></body>'
        page.write_text(canonical, encoding="utf-8")
        check_navigation(root)
        for broken in (
            canonical.replace('id="theme-toggle"', 'id="missing-toggle"'),
            canonical.replace('Skip to content', 'Skip somewhere else'),
            canonical.replace(theme_script(root, page), ''),
            canonical.replace('<script defer src="./docs-nav.js"></script>', ''),
            canonical.replace('</head>', theme_script(root, page) + '</head>'),
            canonical.replace('</head>', '<style>.topbar { color: red }</style></head>'),
            canonical.replace('</body>', '<script>localStorage.getItem("dapp32-theme")</script></body>'),
        ):
            page.write_text(broken, encoding="utf-8")
            try:
                check_navigation(root)
            except AssertionError:
                pass
            else:
                raise AssertionError("a divergent header or duplicated theme owner passed the site check")


def navigation_archive(root: Path) -> None:
    import io
    import stat
    import sys
    import tarfile

    updates = list(shell_updates(root))
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|") as archive:
        for page, text in updates:
            data = text.encode("utf-8")
            info = tarfile.TarInfo(str(page.relative_to(root)))
            info.size = len(data)
            info.mode = stat.S_IMODE(page.stat().st_mode)
            archive.addfile(info, io.BytesIO(data))

BIKE_CAM_MANIFEST_RELATIVE = Path("dapps/bike-nft/cam/main.json")
CHECKED_SOURCE_PATHS = (
    BIKE_CAM_MANIFEST_RELATIVE,
    Path("dapps/escrow/cam/main.json"),
    Path("dapps/escrow/cam/ui.json"),
)

REMOVED_COPY = (
    "Reference CAM dapp",
    "V1 deliberately excludes",
    "mark missing",
    "missing/clear",
    "missing report resolution",
    "addComponentAttestation",
    "ComponentAttested",
)

BIKE_ROUTE_TABLE_HEADER = (
    "Route",
    "Kind",
    "Contract function",
    "Continuation",
    "User-facing purpose",
)


class BikeRouteTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.marked_table_count = 0
        self.in_table = False
        self.table_depth = 0
        self.in_row = False
        self.in_cell = False
        self.current_cell_tag: str | None = None
        self.current_cell: list[str] = []
        self.current_row: list[str] = []
        self.header: tuple[str, ...] | None = None
        self.rows: list[tuple[str, str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "table" and attrs_dict.get("data-check") == "bike-routes":
            self.marked_table_count += 1
            if self.marked_table_count > 1:
                raise AssertionError("expected exactly one bike route table marker; found more than one")
            self.in_table = True
            self.table_depth = 1
        elif self.in_table and tag == "table":
            self.table_depth += 1
        elif self.in_table and self.table_depth == 1 and tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag in {"th", "td"}:
            self.in_cell = True
            self.current_cell_tag = tag
            self.current_cell = []

    def handle_endtag(self, tag: str) -> None:
        if self.in_cell and tag == self.current_cell_tag:
            self.in_cell = False
            self.current_cell_tag = None
            self.current_row.append(" ".join("".join(self.current_cell).split()))
        elif self.in_row and tag == "tr":
            self.in_row = False
            if self.current_row and self.header is None:
                self.header = tuple(self.current_row)
            elif self.current_row:
                if len(self.current_row) != len(BIKE_ROUTE_TABLE_HEADER):
                    raise AssertionError(
                        "bike route table row has wrong column count: "
                        f"expected={len(BIKE_ROUTE_TABLE_HEADER)} actual={len(self.current_row)} "
                        f"row={self.current_row!r}"
                    )
                self.rows.append((self.current_row[0], self.current_row[1], self.current_row[2], self.current_row[3]))
        elif self.in_table and tag == "table":
            self.table_depth -= 1
            if self.table_depth == 0:
                if self.header != BIKE_ROUTE_TABLE_HEADER:
                    raise AssertionError(
                        f"bike route table header drift: expected={BIKE_ROUTE_TABLE_HEADER!r} actual={self.header!r}"
                    )
                self.in_table = False

    def assert_exactly_one_table(self) -> None:
        if self.marked_table_count != 1:
            raise AssertionError(f"expected exactly one bike route table marker; found {self.marked_table_count}")

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell.append(data)


def expected_bike_routes() -> list[tuple[str, str, str, str]]:
    manifest = json.loads(find_bike_cam_manifest().read_text(encoding="utf-8"))
    return [
        (
            route_id,
            route["kind"],
            f'{route["call"]["function"]}({", ".join(route["call"]["args"].keys())})',
            (
                f'{route["then"]["namespace"]}.{route["then"]["function"]}'
                f'({", ".join(f"{name}={value}" for name, value in route["then"]["args"].items())})'
            ),
        )
        for route_id, route in manifest["routes"].items()
    ]


def find_bike_cam_manifest() -> Path:
    env_root = os.environ.get("DAPP32_REPO_ROOT")
    if not env_root:
        raise RuntimeError(
            "DAPP32_REPO_ROOT is required and must point to the dapp32 checkout root "
            f"containing {BIKE_CAM_MANIFEST_RELATIVE}."
        )

    repo_root = Path(env_root).expanduser()
    manifest = repo_root / BIKE_CAM_MANIFEST_RELATIVE
    verify_clean_manifest(repo_root)
    if not manifest.is_file():
        raise FileNotFoundError(
            f"DAPP32_REPO_ROOT={repo_root} does not contain manifest path "
            f"{BIKE_CAM_MANIFEST_RELATIVE}."
        )
    return manifest


def verify_clean_manifest(repo_root: Path) -> None:
    if SOURCE_ARCHIVE_ROOT is not None:
        if repo_root != SOURCE_ARCHIVE_ROOT:
            raise RuntimeError("source archive root changed during validation")
        return

    worktree = subprocess.run(
        ["git", "-C", str(repo_root), "rev-parse", "--is-inside-work-tree"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if worktree.returncode != 0 or worktree.stdout.strip() != "true":
        detail = worktree.stderr.strip() or worktree.stdout.strip()
        raise RuntimeError(
            f"DAPP32_REPO_ROOT={repo_root} is not a git worktree; cannot trust "
            f"manifest path {BIKE_CAM_MANIFEST_RELATIVE}."
            + (f"\nGit said: {detail}" if detail else "")
        )

    status = subprocess.run(
        ["git", "-C", str(repo_root), "status", "--porcelain", "--", *(str(path) for path in CHECKED_SOURCE_PATHS)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if status.returncode != 0:
        detail = status.stderr.strip() or status.stdout.strip()
        raise RuntimeError(
            f"could not inspect documentation source paths in "
            f"DAPP32_REPO_ROOT={repo_root}."
            + (f"\nGit said: {detail}" if detail else "")
        )
    if status.stdout.strip():
        raise RuntimeError(
            f"documentation source paths are dirty in "
            f"DAPP32_REPO_ROOT={repo_root}:\n{status.stdout.rstrip()}"
        )


def main() -> None:
    root = Path(__file__).resolve().parent
    bike_page = root / "bike-nft" / "index.html"
    bike_text = bike_page.read_text(encoding="utf-8")
    index_text = (root / "index.html").read_text(encoding="utf-8")

    parser = BikeRouteTableParser()
    parser.feed(bike_text)
    parser.assert_exactly_one_table()
    expected_routes = expected_bike_routes()
    if parser.rows != expected_routes:
        raise AssertionError(f"bike route table drift:\nexpected={expected_routes!r}\nactual={parser.rows!r}")

    for phrase in REMOVED_COPY:
        if phrase in bike_text or phrase in index_text:
            raise AssertionError(f"removed copy remains in published pages: {phrase}")


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.links: list[str] = []
        self.examples: list[tuple[str, str]] = []
        self.example_owner: str | None = None
        self.example_text: list[str] = []
        self.primary_links: list[str] = []
        self.app_guide_links: list[str] = []
        self.in_primary_nav = False
        self.in_app_guides = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "nav" and attributes.get("aria-label") == "Primary":
            self.in_primary_nav = True
        if tag == "section" and attributes.get("id") == "apps":
            self.in_app_guides = True
        if attributes.get("id"):
            identifier = attributes["id"]
            if identifier in self.ids:
                raise AssertionError(f"duplicate page ID: {identifier}")
            self.ids.add(identifier)
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])
            if self.in_primary_nav:
                self.primary_links.append(attributes["href"])
            if self.in_app_guides:
                self.app_guide_links.append(attributes["href"])
        if tag == "script" and attributes.get("src"):
            self.links.append(attributes["src"])
        if tag == "link" and attributes.get("href"):
            self.links.append(attributes["href"])
        if tag == "pre":
            owner = attributes.get("data-source-route") or attributes.get("data-source-ui")
            if owner:
                self.example_owner = owner
                self.example_text = []

    def handle_data(self, text: str) -> None:
        if self.example_owner:
            self.example_text.append(text)

    def handle_endtag(self, tag: str) -> None:
        if tag == "nav":
            self.in_primary_nav = False
        if tag == "section":
            self.in_app_guides = False
        if tag == "pre" and self.example_owner:
            self.examples.append((self.example_owner, "".join(self.example_text)))
            self.example_owner = None


def check_local_links_and_examples(root: Path, repo_root: Path) -> None:
    from urllib.parse import unquote, urlsplit

    pages: dict[Path, PageParser] = {}
    for page in root.rglob("*.html"):
        if page.relative_to(root) in {Path("viewer/index.html"), Path("deployments/index.html")}:
            continue  # The viewer and legacy redirect have no documentation shell.
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8"))
        if "main" not in parser.ids:
            raise AssertionError(f"missing skip-link destination: {page}")
        pages[page.resolve()] = parser

    homepage = pages[(root / "index.html").resolve()]
    if any(href.startswith("#") for href in homepage.primary_links):
        raise AssertionError("homepage primary navigation must link site destinations, not page sections")
    published_apps = {
        f"{manifest.parent.parent.name}/"
        for manifest in repo_root.glob("dapps/*/cam/main.json")
        if (root / manifest.parent.parent.name / "index.html").is_file()
    }
    if not published_apps.issubset(homepage.app_guide_links):
        raise AssertionError("homepage app guide collection must link every published CAM app guide")

    for page, parser in pages.items():
        for href in parser.links:
            target = urlsplit(href)
            if target.scheme:
                if target.scheme != "https":
                    raise AssertionError(f"unsupported published link: {page}: {href}")
                continue
            if target.netloc:
                raise AssertionError(f"scheme-relative link: {page}: {href}")
            destination = (page.parent / unquote(target.path)).resolve() if target.path else page
            if destination.is_dir():
                destination /= "index.html"
            if not destination.is_relative_to(root.resolve()) or not destination.is_file():
                raise AssertionError(f"missing or out-of-site local link: {page}: {href}")
            if target.fragment:
                # Deployment cards are rendered from checked catalog IDs at runtime.
                if destination == (root / "gallery" / "index.html").resolve():
                    data = json.loads((root / "gallery" / "deployments.json").read_text())
                    allowed = pages[destination].ids | {entry["id"] for entry in data["deployments"]}
                else:
                    allowed = pages[destination].ids
                if target.fragment not in allowed:
                    raise AssertionError(f"missing fragment target: {page}: {href}")

        for owner, text in parser.examples:
            dapp, name = owner.split(":", 1)
            bundle = repo_root / "dapps" / dapp / "cam"
            example = json.loads(text)
            if "kind" in example:
                expected = json.loads((bundle / "main.json").read_text())["routes"][name]
                if example != expected:
                    raise AssertionError(f"route example differs from source: {owner}")
            else:
                def contains(value: object) -> bool:
                    if value == example:
                        return True
                    if isinstance(value, dict):
                        return any(contains(child) for child in value.values())
                    if isinstance(value, list):
                        return any(contains(child) for child in value)
                    return False

                ui = json.loads((bundle / "ui.json").read_text())
                if example.get("element") != name or not contains(ui):
                    raise AssertionError(f"UI example differs from source: {owner}")


def check_deployments(root: Path, repo_root: Path) -> None:
    import re
    from urllib.parse import urlsplit

    page = root / "gallery"
    data = json.loads((page / "deployments.json").read_text())
    viewer = urlsplit(data["viewer"])
    assert viewer.scheme == "https" and viewer.hostname and not viewer.username and not viewer.password
    preview = urlsplit(data["previewViewer"])
    assert (preview.scheme, preview.netloc, preview.path) == ("https", "numpde.github.io", "/dapp32/viewer/")
    assert not preview.username and not preview.password and not preview.query and not preview.fragment
    catalog = json.loads((repo_root / "js/packages/cam-viewer/src/rpc-catalog.json").read_text())
    assert isinstance(data["deployments"], list)
    assert (page / "index.html").is_file() and (page / "deployments.js").is_file()
    assert (root / "deployments" / "index.html").is_file(), "Legacy deployment links require a redirect"
    identifiers = set()
    applications = {}
    for deployment in data["deployments"]:
        identifier = deployment["id"]
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", identifier) and identifier not in identifiers
        identifiers.add(identifier)
        app_id = deployment["appId"]
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", app_id)
        applications.setdefault(app_id, []).append(deployment)
        if "deployedAt" in deployment:
            assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", deployment["deployedAt"])
            import datetime
            datetime.date.fromisoformat(deployment["deployedAt"])
        assert deployment["name"] and deployment["network"] in catalog
        assert isinstance(deployment["chainId"], int) and not isinstance(deployment["chainId"], bool)
        assert deployment["chainId"] == catalog[deployment["network"]]["chainId"], "Published chain identity must match network catalog"
        guide = (page / deployment["guide"] / "index.html").resolve()
        assert guide.is_relative_to(root.resolve()) and guide.is_file()
        address = deployment["host"]
        assert re.fullmatch(r"0x[0-9a-fA-F]{40}", address) and int(address, 16) != 0
        source_pattern = r"https://github\.com/numpde/dapp32/blob/[0-9a-f]{40}/dapps/[A-Za-z0-9_/-]+\.sol"
        assert re.fullmatch(source_pattern, deployment["hostSource"])
        chain_id = catalog[deployment["network"]]["chainId"]
        def verification_link(url: str, contract_address: str) -> None:
            expected = f"https://repo.sourcify.dev/{chain_id}/{contract_address}"
            assert url.lower() == expected.lower(), f"Sourcify verification must address the published contract: {url}"
        if "hostVerificationUrl" in deployment:
            verification_link(deployment["hostVerificationUrl"], address)
        contracts = deployment["contracts"]
        assert isinstance(contracts, list)
        names = set()
        for contract in contracts:
            name, source = contract["name"], contract["source"]
            assert isinstance(name, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name) and name not in names
            names.add(name)
            assert re.fullmatch(r"0x[0-9a-fA-F]{40}", source["address"]) and int(source["address"], 16) != 0
            assert re.fullmatch(source_pattern, source["url"])
            if "verificationUrl" in source:
                verification_link(source["verificationUrl"], source["address"])
        if "rpcUrl" in deployment:
            rpc = urlsplit(deployment["rpcUrl"])
            assert rpc.scheme in {"http", "https"} and rpc.hostname and not rpc.username and not rpc.password
    for app_id, releases in applications.items():
        if len(releases) < 2:
            continue
        dates = [release.get("deployedAt") for release in releases]
        assert all(dates) and len(dates) == len(set(dates)), f"Deployment dates must uniquely identify releases of {app_id}"
        assert len({release["host"].lower() for release in releases}) == len(releases), f"Repeated CAM root in {app_id}"
        assert len({release["name"] for release in releases}) == 1, f"Inconsistent display name in {app_id}"
        assert len({release["guide"] for release in releases}) == 1, f"Inconsistent app guide in {app_id}"


if __name__ == "__main__":
    import argparse

    argument_parser = argparse.ArgumentParser(description="Check published docs against a clean source checkout or explicit git archive export.")
    argument_parser.add_argument("--navigation-archive", action="store_true", help="emit an archive with refreshed static primary navigation")
    argument_parser.add_argument("--source-archive", type=Path, help="source directory produced by git archive of the reviewed commit; default checks DAPP32_REPO_ROOT git cleanliness")
    arguments = argument_parser.parse_args()
    site_root = Path(__file__).resolve().parent
    if arguments.navigation_archive:
        navigation_archive(site_root)
        raise SystemExit(0)
    check_shell_witnesses()
    check_navigation(site_root)
    if arguments.source_archive:
        if (arguments.source_archive / ".git").exists():
            raise RuntimeError("--source-archive requires a git archive export, not a worktree")
        os.environ["DAPP32_REPO_ROOT"] = str(arguments.source_archive)
        # Archive exports contain committed bytes only; no worktree exists to inspect.
        SOURCE_ARCHIVE_ROOT = arguments.source_archive

    main()
    check_local_links_and_examples(Path(__file__).resolve().parent, Path(os.environ["DAPP32_REPO_ROOT"]))
    check_deployments(Path(__file__).resolve().parent, Path(os.environ["DAPP32_REPO_ROOT"]))
    print("Pages checks passed: bike routes, local links, fragments, source-backed examples and deployment data.")