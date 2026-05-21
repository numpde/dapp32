from __future__ import annotations

import re
import unittest

from .common import iter_files, read_text


INSTALL_RE = re.compile(
    r"\b(?P<manager>apt-get|apt)\s+install\b(?P<body>.*?)(?:&&|;|$)"
    r"|\bapk\s+add\b(?P<apk_body>.*?)(?:&&|;|$)",
)


class PackagePinningTest(unittest.TestCase):
    def test_dockerfile_package_installs_are_pinned(self) -> None:
        failures: list[str] = []

        for path in iter_files("containers"):
            if path.name != "Dockerfile":
                continue

            dockerfile = self.join_continuations(read_text(path))
            for match in INSTALL_RE.finditer(dockerfile):
                manager = match.group("manager") or "apk"
                body = match.group("body") if match.group("body") is not None else match.group("apk_body")
                assert body is not None

                for package in self.package_specs(body):
                    if "=" not in package:
                        failures.append(f"{path}: {manager} package is not pinned: {package}")

        if failures:
            self.fail("\n".join(failures))

    def join_continuations(self, text: str) -> str:
        logical_lines: list[str] = []
        current = ""

        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue

            if stripped.endswith("\\"):
                current += stripped[:-1] + " "
                continue

            logical_lines.append(current + stripped)
            current = ""

        if current:
            logical_lines.append(current)

        return "\n".join(logical_lines)

    def package_specs(self, body: str) -> list[str]:
        packages: list[str] = []

        for token in body.split():
            if token.startswith("-"):
                continue
            if "=" in token and token.split("=", 1)[0].isupper():
                continue
            packages.append(token)

        return packages
