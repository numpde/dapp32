from __future__ import annotations

import json
import os
import subprocess
from html.parser import HTMLParser
from pathlib import Path


SOURCE_ARCHIVE_ROOT: Path | None = None

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
            if target.fragment and target.fragment not in pages[destination].ids:
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

    page = root / "deployments"
    data = json.loads((page / "deployments.json").read_text())
    viewer = urlsplit(data["viewer"])
    assert viewer.scheme == "https" and viewer.hostname and not viewer.username and not viewer.password
    catalog = json.loads((repo_root / "js/packages/cam-viewer/src/rpc-catalog.json").read_text())
    assert isinstance(data["deployments"], list)
    identifiers = set()
    for deployment in data["deployments"]:
        identifier = deployment["id"]
        assert re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", identifier) and identifier not in identifiers
        identifiers.add(identifier)
        assert deployment["name"] and deployment["network"] in catalog
        guide = (page / deployment["guide"] / "index.html").resolve()
        assert guide.is_relative_to(root.resolve()) and guide.is_file()
        address = deployment["host"]
        assert re.fullmatch(r"0x[0-9a-fA-F]{40}", address) and int(address, 16) != 0
        contracts = deployment["contracts"]
        assert isinstance(contracts, list) and all(isinstance(name, str) and name for name in contracts)
        assert len(set(contracts)) == len(contracts)
        if "rpcUrl" in deployment:
            rpc = urlsplit(deployment["rpcUrl"])
            assert rpc.scheme in {"http", "https"} and rpc.hostname and not rpc.username and not rpc.password


if __name__ == "__main__":
    import argparse

    argument_parser = argparse.ArgumentParser(description="Check published docs against a clean source checkout or explicit git archive export.")
    argument_parser.add_argument("--source-archive", type=Path, help="source directory produced by git archive of the reviewed commit; default checks DAPP32_REPO_ROOT git cleanliness")
    arguments = argument_parser.parse_args()
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
