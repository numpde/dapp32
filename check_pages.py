from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path


EXPECTED_BIKE_ROUTES = [
    ("entry", "read", "viewEntry(account)"),
    ("component", "read", "viewComponent(serialNumber, account)"),
    ("register", "read", "viewRegister(serialNumber, account)"),
    ("registerComponent", "write", "registerComponent(owner, serialNumber, tokenURI_)"),
    ("setAccountInfo", "write", "setAccountInfo(infoURI)"),
    ("updateComponentMetadata", "write", "setComponentMetadata(serialNumber, tokenURI_)"),
    ("markComponentMissing", "write", "markComponentMissing(serialNumber, reportURI)"),
    ("clearComponentMissing", "write", "clearComponentMissing(serialNumber, resolutionURI)"),
    ("retireComponent", "write", "retireComponent(serialNumber)"),
]

REMOVED_COPY = (
    "Reference CAM dapp",
    "V1 deliberately excludes",
    "mark missing",
    "missing/clear",
    "missing report resolution",
    "addComponentAttestation",
    "ComponentAttested",
)


class BikeRouteTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_cam_section = False
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.current_cell: list[str] = []
        self.current_row: list[str] = []
        self.rows: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        if tag == "section" and attrs_dict.get("id") == "cam":
            self.in_cam_section = True
        elif self.in_cam_section and tag == "table":
            self.in_table = True
        elif self.in_table and tag == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag == "td":
            self.in_cell = True
            self.current_cell = []

    def handle_endtag(self, tag: str) -> None:
        if self.in_cell and tag == "td":
            self.in_cell = False
            self.current_row.append(" ".join("".join(self.current_cell).split()))
        elif self.in_row and tag == "tr":
            self.in_row = False
            if len(self.current_row) >= 3:
                self.rows.append((self.current_row[0], self.current_row[1], self.current_row[2]))
        elif self.in_table and tag == "table":
            self.in_table = False
        elif self.in_cam_section and tag == "section":
            self.in_cam_section = False

    def handle_data(self, data: str) -> None:
        if self.in_cell:
            self.current_cell.append(data)


def main() -> None:
    root = Path(__file__).resolve().parent
    bike_page = root / "bike-nft" / "index.html"
    bike_text = bike_page.read_text(encoding="utf-8")
    index_text = (root / "index.html").read_text(encoding="utf-8")

    parser = BikeRouteTableParser()
    parser.feed(bike_text)
    if parser.rows != EXPECTED_BIKE_ROUTES:
        raise AssertionError(f"bike route table drift:\nexpected={EXPECTED_BIKE_ROUTES!r}\nactual={parser.rows!r}")

    for phrase in REMOVED_COPY:
        if phrase in bike_text or phrase in index_text:
            raise AssertionError(f"removed copy remains in published pages: {phrase}")


if __name__ == "__main__":
    main()
