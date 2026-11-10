"""Check and stage generated documentation without touching the independent viewer."""
from __future__ import annotations

from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import unquote, urljoin, urlsplit


MANIFEST = "docs-publication.json"
RETIRED_FILES = {
    "Makefile", "site.css", "theme.js", "docs_nav.py", "check_pages.py",
    "check_reference.py", "check_navigation.mjs", "check_deployments.mjs",
    "check_networks.mjs",
}
# Workflow definitions are separately provisioned, never rewritten by the
# GITHUB_TOKEN publication job (which has no workflow-write permission).
PAGES_WORKFLOWS = {"pages-check.yml", "viewer-recipe-check.yml"}


class Ids(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.found: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if "id" in attributes and attributes["id"] is not None:
            self.found.add(attributes["id"])


def html_classes(attributes: dict[str, str | None]) -> list[str]:
    value = attributes.get("class")
    return [] if value is None else value.split()


class Navigation(HTMLParser):
    """Observe the actual server-rendered active section and breadcrumbs."""

    def __init__(self) -> None:
        super().__init__()
        self.active_sections: list[str] = []
        self.breadcrumb = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        classes = html_classes(attributes)
        if tag == "a" and "VPNavBarMenuLink" in classes and "active" in classes:
            href = attributes.get("href")
            if href is not None:
                self.active_sections.append(href)
        if tag == "nav" and attributes.get("aria-label") == "Breadcrumb":
            self.breadcrumb = True


class Links(HTMLParser):
    """Gather real links and DOM anchors from generated HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.hrefs: list[str] = []
        self.anchors: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.anchors.add(str(values["id"]))
        if tag == "a" and values.get("href"):
            self.hrefs.append(str(values["href"]))


def check_links(site: Path, pages: list[tuple[str, str]], retired: dict[str, str]) -> None:
    """No authored guide may link to a missing page, anchor or obsolete alias."""
    aliases = {html_path(original).as_posix() for original, canonical in pages
               if original != canonical} | {html_path(original).as_posix() for original in retired}
    catalog = json.loads((site / "gallery/deployments.json").read_text(encoding="utf-8"))
    # Deployed-app sections materialize after the Gallery fetch; these IDs are
    # not present in server-rendered HTML. No other dynamic anchors are allowed.
    gallery_apps = {item["appId"] for item in catalog["deployments"]}
    cached: dict[str, Links] = {}

    def parsed(relative: str) -> Links:
        if relative not in cached:
            result = Links()
            result.feed((site / relative).read_text(encoding="utf-8"))
            cached[relative] = result
        return cached[relative]

    for _, canonical in pages:
        original_html = html_path(canonical).as_posix()
        base = "https://numpde.github.io/dapp32/" + original_html
        for href in parsed(original_html).hrefs:
            target = urlsplit(urljoin(base, href))
            if (target.scheme != "https" or target.netloc != "numpde.github.io"
                    or not target.path.startswith("/dapp32/")):
                continue
            relative = unquote(target.path.removeprefix("/dapp32/"))
            if not relative or relative.endswith("/"):
                relative += "index.html"
            if relative.startswith("viewer/") and relative != "viewer/deploy.html":
                # The separately published viewer has its own build lifecycle.
                continue
            if relative in aliases:
                raise ValueError(f"Page {original_html} still links to old guide URL: {href}")
            resolved = site / relative
            if not resolved.is_file():
                raise ValueError(f"Broken guide link from {original_html}: {href}")
            if target.fragment and resolved.suffix == ".html":
                anchor = unquote(target.fragment)
                if relative == "gallery/index.html" and anchor in gallery_apps:
                    continue
                if anchor not in parsed(relative).anchors:
                    raise ValueError(f"Broken section link from {original_html}: {href}")


def safe_files(root: Path, *, checkout: bool) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        raise ValueError(f"Missing real directory: {root}")
    files: list[Path] = []
    total_size = 0
    for entry in root.rglob("*"):
        path = entry.relative_to(root)
        if checkout and path.parts[0] == ".git":
            continue
        if entry.is_symlink() or ".git" in path.parts:
            raise ValueError(f"Unsafe artifact entry: {path}")
        if entry.is_dir():
            continue
        if not entry.is_file():
            raise ValueError(f"Not a regular file: {path}")
        files.append(entry)
        total_size += entry.stat().st_size
        if len(files) > 2000 or total_size > 100_000_000:
            raise ValueError("Documentation artifact exceeds file/size budget")
    return sorted(files)


def reference_versions(source: Path) -> list[str]:
    """Discover separately published CAM references from the source directory."""
    root = source / "reference/cam"
    versions = sorted(
        item.name for item in root.iterdir()
        if item.is_dir() and (item / "index.html").is_file()
    )
    if not versions:
        raise ValueError("No versioned CAM reference pages")
    return versions


def architecture_model(source: Path, *, definition: dict | None = None) -> dict:
    """The only authored navigation inventory; no per-section config overrides."""
    model = definition if definition is not None else json.loads(
        (source / ".vitepress/architecture.json").read_text(encoding="utf-8")
    )
    if set(model) != {"version", "home", "sections", "retired"} or model["version"] != 3:
        raise ValueError("Expected architecture schema version 3, including the site root")
    return model


def catalog_apps(source: Path, catalog: str) -> list[tuple[str, str]]:
    if catalog != "gallery/deployments.json":
        raise ValueError(f"Unknown sidebar catalog: {catalog}")
    deployments = json.loads((source / "public" / catalog).read_text(encoding="utf-8"))["deployments"]
    apps: dict[str, str] = {}
    for entry in deployments:
        app_id = entry["appId"]
        name = entry["name"]
        if not re.fullmatch(r"[a-z][a-z0-9-]*", app_id) or not isinstance(name, str) or not name:
            raise ValueError(f"Invalid deployment in catalog: {app_id!r}")
        if app_id in apps and apps[app_id] != name:
            raise ValueError(f"Conflicting deployment labels for {app_id}")
        apps[app_id] = name
    if not apps:
        raise ValueError("Gallery catalog is empty")
    return sorted(apps.items())


def canonical_pages(source: Path, *, definition: dict | None = None) -> tuple[list[tuple[str, str]], dict[str, str]]:
    """Every authored guide has exactly one owner, including section landings."""
    model = architecture_model(source, definition=definition)
    sections = model["sections"]
    identifiers = [section.get("id") for section in sections]
    if (not identifiers
            or any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", name)
                   for name in identifiers)
            or len(identifiers) != len(set(identifiers))):
        raise ValueError("Documentation section IDs must be unique and path-safe")

    home = model["home"]
    if (not isinstance(home, dict) or set(home) != {"source", "route", "text"}
            or home["source"] != "index.md" or home["route"] != "index.md"
            or not isinstance(home["text"], str) or not home["text"].strip()
            or not (source / home["source"]).is_file()):
        raise ValueError("Site root must declare the existing index.md at /")

    mapped: list[tuple[str, str]] = [(home["source"], home["route"])]
    sources: set[str] = {home["source"]}
    targets: set[str] = {home["route"]}

    def own(page: dict, section: str) -> None:
        if set(page) != {"source", "route", "text"}:
            raise ValueError(f"Page must name source, route and text: {page}")
        original = page["source"]
        canonical = page["route"]
        if not isinstance(original, str) or not original.endswith(".md") or not isinstance(canonical, str):
            raise ValueError(f"Invalid guide paths: {page}")
        if (original in sources or canonical in targets or not canonical.startswith(section + "/")
                or not canonical.endswith(".md")):
            raise ValueError(f"Duplicate or misplaced guide: {original} -> {canonical}")
        if not isinstance(page["text"], str) or not page["text"].strip():
            raise ValueError(f"Guide has no navigation label: {original}")
        if not (source / original).is_file():
            raise ValueError(f"Navigation points to missing guide: {original}")
        sources.add(original)
        targets.add(canonical)
        mapped.append((original, canonical))

    for section in sections:
        if set(section) != {"id", "label", "summary", "landing", "groups"}:
            raise ValueError(f"Section must have id, label, summary, landing and groups: {section.get('id')}")
        section_id = section["id"]
        if not isinstance(section["label"], str) or not section["label"].strip():
            raise ValueError(f"Unlabeled section: {section_id}")
        if not isinstance(section["summary"], str) or not section["summary"].strip():
            raise ValueError(f"Section has no homepage summary: {section_id}")
        landing = section["landing"]
        if landing["route"] != section_id + "/index.md":
            raise ValueError(f"Missing section landing: {section_id}")
        own(landing, section_id)
        if not section["groups"]:
            raise ValueError(f"Section without sidebar content: {section_id}")
        catalog_count = 0
        for group in section["groups"]:
            kind = group.get("kind")
            if kind == "catalog":
                if (set(group) != {"kind", "title", "catalog", "anchor"}
                        or section_id != "gallery" or group["anchor"] != "appId"):
                    raise ValueError(f"Invalid catalog sidebar group: {section_id}")
                catalog_apps(source, group["catalog"])
                catalog_count += 1
                continue
            if kind != "pages" or set(group) - {"kind", "title", "pages", "parent", "collapsed"}:
                raise ValueError(f"Invalid sidebar group kind or keys: {section_id}")
            if not isinstance(group.get("pages"), list) or not group["pages"]:
                raise ValueError(f"Empty page group: {section_id}")
            if "collapsed" in group and not isinstance(group["collapsed"], bool):
                raise ValueError(f"Invalid collapse state: {section_id}")
            parent = group.get("parent")
            if parent and parent not in {p["source"] for p in group["pages"]}:
                raise ValueError(f"Breadcrumb parent is not a member of its group: {parent}")
            for page in group["pages"]:
                own(page, section_id)
        if section_id == "gallery":
            if catalog_count != 1 or len(section["groups"]) != 1:
                raise ValueError("Gallery sidebar is only its catalog of deployed applications")
        elif catalog_count:
            raise ValueError(f"Unowned catalog sidebar in {section_id}")

    retired = model["retired"]
    if any(path in sources for path in retired):
        raise ValueError("A retired guide still has a canonical owner")
    observed = {path.relative_to(source).as_posix() for path in source.rglob("*.md")}
    expected = sources | set(retired)
    if observed != expected:
        raise ValueError(f"Documentation inventory differs from routes: "
                         f"missing={sorted(expected - observed)}, unowned={sorted(observed - expected)}")
    return mapped, retired


def sidebar_links(source: Path, section: str | None) -> list[str]:
    """Project sidebar destinations, including the declared parent site root."""
    model = architecture_model(source)
    if section is None:
        return ["/dapp32/" + route_url(item["landing"]["route"])
                for item in model["sections"]]
    owner = next((item for item in model["sections"] if item["id"] == section), None)
    if owner is None:
        raise ValueError(f"Unknown sidebar section: {section}")
    links: list[str] = []
    for group in owner["groups"]:
        if group["kind"] == "pages":
            links.extend("/dapp32/" + route_url(page["route"]) for page in group["pages"])
        elif group["kind"] == "catalog":
            links.extend("/dapp32/" + section + "/#" + app_id
                         for app_id, _ in catalog_apps(source, group["catalog"]))
        else:
            raise ValueError(f"Unsupported sidebar group type: {group}")
    return links


class HomeCards(HTMLParser):
    """Find the actual server-rendered homepage section cards."""

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.cards: list[dict[str, str | list[str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if self.depth:
            self.depth += 1
            if tag == "a" and values.get("href"):
                hrefs = self.cards[-1]["hrefs"]
                assert isinstance(hrefs, list)
                hrefs.append(str(values["href"]))
        elif tag == "section" and "home-section-card" in html_classes(values):
            self.depth = 1
            self.cards.append({"section": str(values.get("data-section")), "hrefs": [], "text": ""})

    def handle_data(self, data: str) -> None:
        if self.depth:
            self.cards[-1]["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if self.depth:
            self.depth -= 1


def check_home_cards(source: Path, site: Path) -> None:
    """Home's six cards must exactly mirror the six declared sections."""
    observed = HomeCards()
    observed.feed((site / "index.html").read_text(encoding="utf-8"))
    model = architecture_model(source)
    expected = []
    for section in model["sections"]:
        landing = "/dapp32/" + route_url(section["landing"]["route"])
        expected.append((section["id"], [landing]))
    actual = [(card["section"], card["hrefs"]) for card in observed.cards]
    if actual != expected:
        raise ValueError(f"Homepage section cards disagree with navigation inventory: {actual} != {expected}")
    for card, section in zip(observed.cards, model["sections"]):
        if section["label"] not in card["text"] or section["summary"] not in card["text"]:
            raise ValueError(f"Homepage card text disagrees with section metadata: {section['id']}")


class SidebarLinks(HTMLParser):
    """Read only VitePress's sidebar; content links cannot masquerade as navigation."""

    def __init__(self) -> None:
        super().__init__()
        self.depth = 0
        self.present = False
        self.hrefs: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if self.depth:
            self.depth += 1
            if tag == "a" and values.get("href"):
                self.hrefs.append(str(values["href"]))
        elif tag == "aside" and "VPSidebar" in html_classes(values):
            self.present = True
            self.depth = 1

    def handle_endtag(self, tag: str) -> None:
        if self.depth:
            self.depth -= 1



def html_path(markdown: str) -> Path:
    return Path(markdown).with_suffix(".html")


def route_url(markdown: str) -> str:
    if markdown.endswith("/index.md"):
        return markdown.removesuffix("index.md")
    return markdown.removesuffix(".md") + ".html"


def check(source: Path, site: Path, *, published: bool) -> list[Path]:
    files = safe_files(site, checkout=published)
    if not published and (
        (site / MANIFEST).exists() or (site / ".github").exists()
        or (site / "viewer/index.html").exists() or (site / "viewer/assets").exists()
    ):
        raise ValueError("Build artifact attempts to publish control files or viewer")
    pages, retired = canonical_pages(source)
    check_home_cards(source, site)
    for original, canonical in pages:
        output = html_path(canonical)
        if not (site / output).is_file() or (site / output).stat().st_size < 100:
            raise ValueError(f"Missing generated page: {output}")

        rendered = (site / output).read_text(encoding="utf-8")
        parser = Navigation()
        parser.feed(rendered)
        section = canonical.split("/", 1)[0] if canonical != architecture_model(source)["home"]["route"] else None
        sidebar = SidebarLinks()
        sidebar.feed(rendered)
        expected_sidebar = sidebar_links(source, section)
        if not sidebar.present:
            raise ValueError(f"Required sidebar is absent on {output}")
        if sidebar.hrefs != expected_sidebar:
            raise ValueError(f"Sidebar contains an extra, missing, duplicate or cross-section link on "
                             f"{output}: observed={sidebar.hrefs}, expected={expected_sidebar}")
        expected_nav = [] if section is None else ["/dapp32/" + section + "/"]
        if parser.active_sections != expected_nav:
            raise ValueError(f"Incorrect top-level navigation on {output}: "
                             f"{parser.active_sections} != {expected_nav}")
        root = section is None or canonical == section + "/index.md"
        if parser.breadcrumb == root:
            raise ValueError(f"Breadcrumb presence disagrees with real page ancestry: {output}")

        if original != canonical:
            alias = site / html_path(original)
            destination = "/dapp32/" + route_url(canonical)
            if not alias.is_file() or destination not in alias.read_text(encoding="utf-8"):
                raise ValueError(f"Missing legacy link redirect: {original} -> {canonical}")
    for original, destination in retired.items():
        alias = site / html_path(original)
        if not alias.is_file() or "/dapp32/" + destination not in alias.read_text(encoding="utf-8"):
            raise ValueError(f"Missing retired-guide redirect: {original}")
    for version in reference_versions(source):
        path = Path("reference/cam") / version / "index.html"
        if (source / path).read_bytes() != (site / path).read_bytes():
            raise ValueError(f"Modified versioned protocol reference: {version}")
    for path in ("index.html", "deployments/index.html", "viewer/deploy.html"):
        if not (site / path).is_file():
            raise ValueError(f"Missing published route: {path}")
    catalog = json.loads((site / "gallery/deployments.json").read_text())
    if not isinstance(catalog["deployments"], list) or not catalog["deployments"]:
        raise ValueError("Gallery is missing deployments")
    # The catalog is copied unchanged; sidebar destinations were checked on
    # every rendered page above, against application IDs in the source catalog.
    if ((site / "gallery/deployments.json").read_bytes()
            != (source / "public/gallery/deployments.json").read_bytes()):
        raise ValueError("Generated Gallery catalog differs from its source")
    gallery_html = (site / "gallery/index.html").read_text(encoding="utf-8")
    if ('class="gallery-status is-loading"' not in gallery_html
            or 'aria-busy="true"' not in gallery_html
            or 'gallery-loading-card' not in gallery_html):
        raise ValueError("Gallery lacks visible initial loading indicators")
    for page, ids in (
        ("gallery/index.html", {"load-status", "retry", "deployments"}),
        ("deploy/networks/index.html", {"load-status", "reference", "networks", "network-jump"}),
    ):
        parser = Ids()
        parser.feed((site / page).read_text())
        if not ids <= parser.found:
            raise ValueError(f"Page {page} is missing interactive DOM mounts {ids - parser.found}")
    if not any((site / "assets").glob("*.js")):
        raise ValueError("No compiled JavaScript assets")
    check_links(site, pages, retired)
    return files


def stage(source: Path, built: Path, site: Path, sha: str, run: str) -> None:
    qualified = check(source, built, published=False)
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"[1-9][0-9]*", run):
        raise ValueError("Invalid qualification source SHA or run ID")
    expected_roots = {entry.name for entry in built.iterdir()} | RETIRED_FILES | {
        ".git", ".github", "viewer", ".nojekyll", MANIFEST,
    }
    if {entry.name for entry in site.iterdir()} - expected_roots:
        raise ValueError("Pages checkout contains unowned roots; refuse deletion")
    safe_files(site, checkout=True)
    workflows = site / ".github/workflows"
    if not workflows.is_dir() or {p.name for p in workflows.iterdir()} != PAGES_WORKFLOWS:
        raise ValueError("Pages workflows must be provisioned separately before publishing")
    if ((workflows / "pages-check.yml").read_bytes()
            != (source / "publishing/pages-check.yml").read_bytes()):
        raise ValueError("Published Pages verifier does not match the reviewed source")
    viewer = site / "viewer"
    if viewer.exists() and {p.name for p in viewer.iterdir()} - {
        "index.html", "assets", "deploy.html",
    }:
        raise ValueError("Unknown viewer resource; refuse deletion")

    hashes = {file.relative_to(built).as_posix(): sha256(file.read_bytes()).hexdigest()
              for file in qualified}
    for item in site.iterdir():
        if item.name in {".git", ".github", "viewer"}:
            continue
        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()
    (viewer / "deploy.html").unlink(missing_ok=True)
    for file in qualified:
        target = site / file.relative_to(built)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, target)
    (site / ".nojekyll").touch()
    manifest = {
        "schema": "docs-publication/v1", "source_sha": sha,
        "qualified_run_id": int(run), "files": hashes,
    }
    (site / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    check_published(source, site)


def check_published(source: Path, site: Path) -> None:
    files = check(source, site, published=True)
    manifest = json.loads((site / MANIFEST).read_text())
    if manifest["schema"] != "docs-publication/v1":
        raise ValueError("Unknown publication manifest schema")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["source_sha"]):
        raise ValueError("Invalid recorded source SHA")
    if not isinstance(manifest["qualified_run_id"], int) or manifest["qualified_run_id"] < 1:
        raise ValueError("Invalid qualification run")
    expected = manifest["files"]
    actual = {}
    for file in files:
        relative = file.relative_to(site).as_posix()
        if relative in {MANIFEST, ".nojekyll", ".github/workflows/pages-check.yml",
                        ".github/workflows/viewer-recipe-check.yml"}:
            continue
        if relative == "viewer/index.html" or relative.startswith("viewer/assets/"):
            continue
        actual[relative] = sha256(file.read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError(
            f"Published files diverge from qualified artifact: "
            f"missing={sorted(expected.keys() - actual.keys())}, "
            f"extra={sorted(actual.keys() - expected.keys())}, "
            f"altered={sorted(k for k in actual.keys() & expected.keys() if actual[k] != expected[k])}"
        )
    if not (site / ".nojekyll").is_file():
        raise ValueError("GitHub Pages needs .nojekyll")
    if ((site / ".github/workflows/pages-check.yml").read_bytes()
            != (source / "publishing/pages-check.yml").read_bytes()):
        raise ValueError("Generated-site workflow differs from reviewed source")


def main() -> None:
    args = sys.argv[1:]
    if len(args) == 3 and args[0] == "check":
        check(Path(args[1]), Path(args[2]), published=False)
    elif len(args) == 3 and args[0] == "check-published":
        check_published(Path(args[1]), Path(args[2]))
    elif len(args) == 6 and args[0] == "stage":
        stage(Path(args[1]), Path(args[2]), Path(args[3]), args[4], args[5])
    else:
        raise SystemExit("usage: docs_site.py check SOURCE SITE | "
                         "check-published SOURCE SITE | "
                         "stage SOURCE BUILT SITE SHA RUN")
    print("Qualified documentation contents verified.")


if __name__ == "__main__":
    main()
