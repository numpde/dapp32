"""Check source ownership of protocol references used by current app manifests."""
from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory


class Links(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.hrefs: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value is not None:
                    self.hrefs.add(value)


def check_current_references(site: Path, source: Path) -> None:
    manifests = sorted(source.glob("dapps/*/cam/main.json"))
    if not manifests:
        raise AssertionError("No source app manifests found for reference verification")
    versions = {json.loads(path.read_text(encoding="utf-8"))["cam"] for path in manifests}
    index = Links()
    index.feed((site / "reference/cam/index.html").read_text(encoding="utf-8"))
    for version in sorted(versions):
        if not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
            raise AssertionError(f"Invalid source CAM version: {version!r}")
        relative = Path("reference/cam") / version / "index.html"
        published = site / relative
        canonical = source / "docs" / relative
        if not published.is_file() or not canonical.is_file():
            raise AssertionError(f"Missing current reference: {relative}")
        if published.read_bytes() != canonical.read_bytes():
            raise AssertionError(f"Published reference differs from source bytes: {relative}")
        if f"{version}/" not in index.hrefs:
            raise AssertionError(f"Current reference missing from index links: {version}")


def check_witnesses() -> None:
    with TemporaryDirectory() as directory:
        root = Path(directory)
        source, site = root / "source", root / "site"
        manifest = source / "dapps/example/cam/main.json"
        canonical = source / "docs/reference/cam/9.7.0/index.html"
        published = site / "reference/cam/9.7.0/index.html"
        index = site / "reference/cam/index.html"
        for path in (manifest, canonical, published):
            path.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text('{"cam":"9.7.0"}', encoding="utf-8")
        canonical.write_bytes(b"exact protocol bytes\n")
        published.write_bytes(canonical.read_bytes())
        index.write_text('<a href="9.7.0/">Any editorial wording</a>', encoding="utf-8")
        check_current_references(site, source)
        for mutation in ("changed bytes", "missing file", "missing link"):
            published.write_bytes(canonical.read_bytes())
            index.write_text('<a href="9.7.0/">Different wording is valid</a>', encoding="utf-8")
            if mutation == "changed bytes":
                published.write_bytes(b"different protocol bytes\n")
            elif mutation == "missing file":
                published.unlink()
            else:
                index.write_text('<a href="9.6.0/">Old reference only</a>', encoding="utf-8")
            try:
                check_current_references(site, source)
            except AssertionError:
                continue
            raise AssertionError(f"Invalid reference passed the witness: {mutation}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_archive", type=Path)
    arguments = parser.parse_args()
    check_witnesses()
    check_current_references(Path(__file__).resolve().parent, arguments.source_archive)
    print("Current protocol references match source bytes and are linked from the index.")
