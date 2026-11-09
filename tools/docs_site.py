"""Check and stage generated documentation without touching the independent viewer."""
from __future__ import annotations

from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
import sys


VERSIONS = ("1.1.0", "1.2.0", "1.3.0", "1.4.0")
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


def check(source: Path, site: Path, *, published: bool) -> list[Path]:
    files = safe_files(site, checkout=published)
    if not published and (
        (site / MANIFEST).exists() or (site / ".github").exists()
        or (site / "viewer/index.html").exists() or (site / "viewer/assets").exists()
    ):
        raise ValueError("Build artifact attempts to publish control files or viewer")
    pages = sorted(source.rglob("*.md"))
    if len(pages) < 30:
        raise ValueError("Unexpectedly incomplete source documentation")
    for page in pages:
        relative = page.relative_to(source)
        output = relative.parent / ("index.html" if relative.name == "index.md"
                                    else relative.stem + ".html")
        if not (site / output).is_file() or (site / output).stat().st_size < 100:
            raise ValueError(f"Missing generated page: {output}")
    for version in VERSIONS:
        path = Path("reference/cam") / version / "index.html"
        if (source / path).read_bytes() != (site / path).read_bytes():
            raise ValueError(f"Modified versioned protocol reference: {version}")
    for path in ("index.html", "deployments/index.html", "viewer/deploy.html"):
        if not (site / path).is_file():
            raise ValueError(f"Missing published route: {path}")
    catalog = json.loads((site / "gallery/deployments.json").read_text())
    if not isinstance(catalog["deployments"], list) or not catalog["deployments"]:
        raise ValueError("Gallery is missing deployments")
    for page, ids in (
        ("gallery/index.html", {"load-status", "retry", "deployments"}),
        ("deployment/networks/index.html", {"load-status", "reference", "networks", "network-jump"}),
    ):
        parser = Ids()
        parser.feed((site / page).read_text())
        if not ids <= parser.found:
            raise ValueError(f"Page {page} is missing interactive DOM mounts {ids - parser.found}")
    if not any((site / "assets").glob("*.js")):
        raise ValueError("No compiled JavaScript assets")
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
