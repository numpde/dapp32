from __future__ import annotations

import re
import unittest

from .common import iter_repo_text_files, read_text, repo_path


FORBIDDEN_NAME_PATTERNS = [
    re.compile("dapp" + "32", re.IGNORECASE),
]

LICENSE_MARKERS = [
    "SPDX-" + "License-Identifier",
    "Permission is hereby " + "granted",
    "THE SOFTWARE IS " + "PROVIDED",
]

SECRET_PATTERNS = [
    re.compile("GITHUB_" + "ACCESS_TOKEN"),
    re.compile(r"github_pat_[A-Za-z0-9_]+"),
    re.compile(r"ghp_[A-Za-z0-9_]{20,}"),
    re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
]


class RepositoryHygieneTest(unittest.TestCase):
    def test_forbidden_text_patterns_are_absent(self) -> None:
        self.assert_no_matches(FORBIDDEN_NAME_PATTERNS, "forbidden project name")
        markers = [re.compile(re.escape(marker)) for marker in LICENSE_MARKERS]
        self.assert_no_matches(markers, "license marker")
        self.assert_no_matches(SECRET_PATTERNS, "secret pattern")

    def test_js_build_outputs_are_not_materialized_on_host(self) -> None:
        failures: list[str] = []
        for workspace_root in (repo_path("js/packages"), repo_path("js/apps")):
            if not workspace_root.is_dir():
                continue
            for package_root in sorted(path for path in workspace_root.iterdir() if path.is_dir()):
                dist = package_root / "dist"
                if dist.exists():
                    failures.append(f"{dist}: JS build output must stay in container tmpfs")

        if failures:
            self.fail("\n".join(failures))

    def assert_no_matches(self, patterns: list[re.Pattern[str]], label: str) -> None:
        failures: list[str] = []

        for path in iter_repo_text_files():
            text = read_text(path)
            for line_number, line in enumerate(text.splitlines(), start=1):
                if any(pattern.search(line) for pattern in patterns):
                    failures.append(f"{path}:{line_number}: {label}")

        if failures:
            self.fail("\n".join(failures))
