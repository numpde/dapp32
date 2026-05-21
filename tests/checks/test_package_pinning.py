from __future__ import annotations

import re
import unittest

from .common import iter_files, read_text


INSTALL_RE = re.compile(
    r"\b(?P<manager>apt-get|apt)\s+install\b(?P<body>.*?)(?:&&|;|\n|$)"
    r"|\bapk\s+add\b(?P<apk_body>.*?)(?:&&|;|\n|$)",
)


class PackagePinningTest(unittest.TestCase):
    def test_dockerfile_package_installs_are_pinned(self) -> None:
        failures: list[str] = []

        for path in iter_files("containers"):
            if path.name != "Dockerfile":
                continue

            failures.extend(self.package_pin_failures(read_text(path), str(path)))

        if failures:
            self.fail("\n".join(failures))

    def test_self_check_accepts_pinned_installs(self) -> None:
        dockerfile = r"""
        FROM example
        RUN apk add --no-cache \
              docker-cli=29.5.1-r0 \
              docker-cli-compose=2.40.3-r6
        RUN apt-get update; apt-get install -y --no-install-recommends \
              ca-certificates=20240203~22.04.1 \
              curl=7.81.0-1ubuntu1.24
        """

        self.assertEqual([], self.package_pin_failures(dockerfile, "pinned-fixture"))

    def test_self_check_rejects_unpinned_installs(self) -> None:
        dockerfile = r"""
        FROM example
        RUN apk add --no-cache docker-cli docker-cli-compose=2.40.3-r6
        RUN apt-get update; apt-get install -y --no-install-recommends curl=7.81.0-1ubuntu1.24 unzip
        """

        self.assertEqual(
            [
                "unpinned-fixture: apk package is not pinned: docker-cli",
                "unpinned-fixture: apt-get package is not pinned: unzip",
            ],
            self.package_pin_failures(dockerfile, "unpinned-fixture"),
        )

    def package_pin_failures(self, text: str, path_label: str) -> list[str]:
        failures: list[str] = []
        dockerfile = self.join_continuations(text)

        for match in INSTALL_RE.finditer(dockerfile):
            manager = match.group("manager") or "apk"
            body = match.group("body") if match.group("body") is not None else match.group("apk_body")
            assert body is not None

            for package in self.package_specs(body):
                if "=" not in package:
                    failures.append(f"{path_label}: {manager} package is not pinned: {package}")

        return failures

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
