from __future__ import annotations

import json
import os
import subprocess
from html.parser import HTMLParser
from pathlib import Path


BIKE_CAM_MANIFEST_RELATIVE = Path("dapps/bike-nft/cam/main.json")

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
        ["git", "-C", str(repo_root), "status", "--porcelain", "--", str(BIKE_CAM_MANIFEST_RELATIVE)],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if status.returncode != 0:
        detail = status.stderr.strip() or status.stdout.strip()
        raise RuntimeError(
            f"could not inspect manifest path {BIKE_CAM_MANIFEST_RELATIVE} in "
            f"DAPP32_REPO_ROOT={repo_root}."
            + (f"\nGit said: {detail}" if detail else "")
        )
    if status.stdout.strip():
        raise RuntimeError(
            f"manifest path {BIKE_CAM_MANIFEST_RELATIVE} is dirty in "
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


if __name__ == "__main__":
    main()
