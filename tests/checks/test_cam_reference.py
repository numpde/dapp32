from hashlib import sha256
from html.parser import HTMLParser
import unittest
from urllib.parse import urlsplit

from tests.checks.common import ROOT
from tools.json_policy import strict_json_loads


REFERENCE = ROOT / "docs/reference/cam"


class ReferenceHTML(HTMLParser):
    def __init__(self, text: str):
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.links: list[str] = []
        self.external_resources: list[str] = []
        self.examples: dict[str, str] = {}
        self.active_example: str | None = None
        self.feed(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        fields = dict(attrs)
        identifier = fields.get("id")
        if identifier is not None:
            self.ids.append(identifier)
        if tag == "a" and fields.get("href") is not None:
            self.links.append(fields["href"])
        if tag in {"script", "link", "iframe", "img"}:
            self.external_resources.append(tag)
        if tag == "pre" and identifier is not None and identifier.startswith("example-"):
            self.active_example = identifier
            self.examples[identifier] = ""

    def handle_data(self, text: str):
        if self.active_example is not None:
            self.examples[self.active_example] += text

    def handle_endtag(self, tag: str):
        if tag == "pre":
            self.active_example = None


class CamReferenceTests(unittest.TestCase):
    def test_reference_navigation_and_standalone_resources(self):
        pages = sorted(REFERENCE.rglob("*.html"))
        self.assertTrue(pages)
        for path in pages:
            with self.subTest(page=path.relative_to(ROOT)):
                document = ReferenceHTML(path.read_text(encoding="utf-8"))
                self.assertEqual(len(document.ids), len(set(document.ids)))
                self.assertIn("main", document.ids)
                if path != REFERENCE / "index.html":
                    self.assertIn("#main", document.links)
                self.assertEqual(document.external_resources, [])
                for link in document.links:
                    target = urlsplit(link)
                    if target.scheme:
                        self.assertEqual(target.scheme, "https", link)
                        continue
                    linked_path = path if not target.path else path.parent / target.path
                    if linked_path.is_dir():
                        linked_path = linked_path / "index.html"
                    self.assertTrue(linked_path.is_file(), link)
                    if target.fragment:
                        linked_document = ReferenceHTML(linked_path.read_text(encoding="utf-8"))
                        self.assertIn(target.fragment, linked_document.ids, link)

    def test_worked_example_resource_bytes_match_manifest(self):
        for version in ("1.1.0", "1.2.0"):
            with self.subTest(version=version):
                document = ReferenceHTML((REFERENCE / version / "index.html").read_text(encoding="utf-8"))
                manifest = strict_json_loads(document.examples["example-cam"])
                for namespace, example in (("contracts.Registry", "example-abi"), ("ui", "example-ui")):
                    resource_bytes = document.examples[example].encode("utf-8")
                    strict_json_loads(document.examples[example])
                    self.assertEqual(
                        manifest["namespaces"][namespace]["integrity"],
                        "sha256:0x" + sha256(resource_bytes).hexdigest(),
                        namespace,
                    )


if __name__ == "__main__":
    unittest.main()
