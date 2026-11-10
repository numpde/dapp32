"""Validate and stage the qualified static viewer without touching Pages documentation."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import shutil
import sys


ASSET_REFERENCE = re.compile(r"\./assets/[A-Za-z0-9._-]+")


class ViewerIndex(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.has_root = False
        self.references: list[str] = []
        self.scripts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id") == "root":
            self.has_root = True
        reference = values.get("src") if tag == "script" else values.get("href") if tag == "link" else None
        if reference is not None:
            self.references.append(reference)
            if tag == "script":
                self.scripts.append(reference)


def check_bundle(root: Path, *, guide: bool) -> str:
    """Return the built JavaScript entry only for a complete, relocatable bundle."""
    if not root.is_dir() or root.is_symlink():
        raise ValueError(f"Viewer bundle must be a real directory: {root}")
    index, assets = root / "index.html", root / "assets"
    if not index.is_file() or index.is_symlink() or not assets.is_dir() or assets.is_symlink():
        raise ValueError(f"Viewer must contain a regular index and real assets directory: {root}")
    if guide and (not (root / "deploy.html").is_file() or (root / "deploy.html").is_symlink()):
        raise ValueError("Existing Pages hosting guide must remain a regular file")

    entries = sorted(assets.rglob("*"))
    if not entries or len(entries) > 100 or any(not entry.is_file() or entry.is_symlink() for entry in entries):
        raise ValueError("Viewer assets must be bounded regular files without directories or symlinks")
    if sum(entry.stat().st_size for entry in entries) > 30_000_000:
        raise ValueError("Viewer assets exceed the size budget")

    index_parser = ViewerIndex()
    index_parser.feed(index.read_text(encoding="utf-8"))
    if not index_parser.has_root or not index_parser.references:
        raise ValueError("Viewer index lacks an application root or asset references")
    if any(not ASSET_REFERENCE.fullmatch(ref) or not (root / ref).is_file()
           for ref in index_parser.references):
        raise ValueError(f"Viewer references missing or nonlocal assets: {index_parser.references}")
    scripts = [ref for ref in index_parser.scripts if ref.endswith(".js")]
    if len(scripts) != 1 or not any(ref.endswith(".css") for ref in index_parser.references):
        raise ValueError("Viewer must link one JavaScript entry and its stylesheet")
    return scripts[0]


def stage_bundle(qualified: Path, published: Path) -> str:
    """Replace only viewer/index.html and viewer/assets in the Pages checkout."""
    if not qualified.is_dir() or qualified.is_symlink() or {
        entry.name for entry in qualified.iterdir()
    } != {"index.html", "assets"}:
        raise ValueError("Qualified artifact must contain only index.html and assets/")
    entry = check_bundle(qualified, guide=False)
    if not published.is_dir() or published.is_symlink():
        raise ValueError(f"Missing real Pages viewer directory: {published}")
    if not (published / "deploy.html").is_file() or (published / "deploy.html").is_symlink():
        raise ValueError("Pages viewer hosting guide is missing or unsafe")
    if (published / "index.html").is_symlink() or (published / "assets").is_symlink():
        raise ValueError("Published viewer paths must not be symlinks")
    if (published / "assets").exists() and not (published / "assets").is_dir():
        raise ValueError("Published viewer assets path is not a directory")

    if (published / "assets").exists():
        shutil.rmtree(published / "assets")
    shutil.copytree(qualified / "assets", published / "assets")
    shutil.copyfile(qualified / "index.html", published / "index.html")
    return entry


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "check":
            print(check_bundle(Path(sys.argv[2]), guide=True))
        elif len(sys.argv) == 4 and sys.argv[1] == "stage":
            print(stage_bundle(Path(sys.argv[2]), Path(sys.argv[3])))
        else:
            raise ValueError("usage: viewer_pages.py check VIEWER or stage QUALIFIED PAGES_VIEWER")
    except (OSError, ValueError) as error:
        raise SystemExit(f"viewer-pages: {error}") from error
