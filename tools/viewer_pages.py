"""Own the Pages viewer's qualified bundle and its publication manifest.

The viewer owns only index.html, assets/ and viewer-publication.json; deploy.html
belongs to documentation and must survive viewer updates. The publisher writes
a manifest containing the exact main source, qualifying CI run, and hashes of
the bytes staged on gh-pages. This is publication evidence, not a second
hand-maintained list of assets; all files are discovered from the built bundle.

The independent pages_integrity auditor uses check_published without any
write permission. Do not expand this owner to documentation, release artifacts,
or the independently hosted production viewer.
"""

from __future__ import annotations

from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import sys


ASSET_REFERENCE = re.compile(r"\./assets/[A-Za-z0-9._-]+")
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
MANIFEST = "viewer-publication.json"


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


def check_published(root: Path) -> dict:
    """Verify publication ownership and exact file hashes from the manifest."""
    check_bundle(root, guide=True)
    if {item.name for item in root.iterdir()} != {
        "index.html", "assets", "deploy.html", MANIFEST,
    } or (root / MANIFEST).is_symlink():
        raise ValueError("Unexpected or unsafe published viewer files")
    manifest = json.loads((root / MANIFEST).read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or set(manifest) != {
        "schema", "source_sha", "qualified_run_id", "files",
    } or manifest["schema"] != "viewer-publication/v1"
            or not isinstance(manifest["source_sha"], str)
            or SOURCE_SHA.fullmatch(manifest["source_sha"]) is None
            or type(manifest["qualified_run_id"]) is not int
            or manifest["qualified_run_id"] < 1
            or not isinstance(manifest["files"], dict)):
        raise ValueError("Invalid viewer publication provenance")

    files = [root / "index.html", *sorted((root / "assets").iterdir())]
    actual = {path.relative_to(root).as_posix(): sha256(path.read_bytes()).hexdigest()
              for path in files}
    if actual != manifest["files"]:
        missing = sorted(actual.keys() - manifest["files"].keys())
        extra = sorted(manifest["files"].keys() - actual.keys())
        altered = sorted(key for key in actual.keys() & manifest["files"].keys()
                         if actual[key] != manifest["files"][key])
        raise ValueError(f"Viewer publication differs from qualified files: "
                         f"unrecorded={missing} missing={extra} altered={altered}")
    return manifest


def stage_bundle(qualified: Path, published: Path, source_sha: str, run_id: int) -> str:
    """Replace the viewer and record the exact source, run, and file hashes."""
    if SOURCE_SHA.fullmatch(source_sha) is None or type(run_id) is not int or run_id < 1:
        raise ValueError("Invalid viewer qualification source or run")
    if not qualified.is_dir() or qualified.is_symlink() or {
        entry.name for entry in qualified.iterdir()
    } != {"index.html", "assets"}:
        raise ValueError("Qualified artifact must contain only index.html and assets/")
    entry = check_bundle(qualified, guide=False)
    if not published.is_dir() or published.is_symlink():
        raise ValueError(f"Missing real Pages viewer directory: {published}")
    if not (published / "deploy.html").is_file() or (published / "deploy.html").is_symlink():
        raise ValueError("Pages viewer hosting guide is missing or unsafe")
    if (published / "index.html").is_symlink() or (published / "assets").is_symlink() \
            or (published / MANIFEST).is_symlink():
        raise ValueError("Published viewer paths must not be symlinks")
    if (published / "assets").exists() and not (published / "assets").is_dir():
        raise ValueError("Published viewer assets path is not a directory")
    if {item.name for item in published.iterdir()} - {
        "index.html", "assets", "deploy.html", MANIFEST,
    }:
        raise ValueError("Unexpected published viewer entry; refuse overwrite")

    if (published / "assets").exists():
        shutil.rmtree(published / "assets")
    shutil.copytree(qualified / "assets", published / "assets")
    shutil.copyfile(qualified / "index.html", published / "index.html")
    files = [published / "index.html", *sorted((published / "assets").iterdir())]
    hashes = {path.relative_to(published).as_posix(): sha256(path.read_bytes()).hexdigest()
              for path in files}
    manifest = {"schema": "viewer-publication/v1", "source_sha": source_sha,
                "qualified_run_id": run_id, "files": hashes}
    (published / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n",
                                      encoding="utf-8")
    check_published(published)
    return entry


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "check":
            print(check_bundle(Path(sys.argv[2]), guide=True))
        elif len(sys.argv) == 3 and sys.argv[1] == "check-published":
            check_published(Path(sys.argv[2]))
            print("Published viewer files match the recorded qualification.")
        elif len(sys.argv) == 6 and sys.argv[1] == "stage":
            print(stage_bundle(Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4],
                               int(sys.argv[5])))
        else:
            raise ValueError("usage: viewer_pages.py check VIEWER | check-published VIEWER | "
                             "stage QUALIFIED PAGES_VIEWER SHA RUN")
    except (OSError, ValueError) as error:
        raise SystemExit(f"viewer-pages: {error}") from error
