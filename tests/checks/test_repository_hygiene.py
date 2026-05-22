from __future__ import annotations

import re
import unittest

from .common import SKIP_DIRS, iter_repo_text_files, read_text, repo_path


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
    def test_forbidden_project_name_is_absent(self) -> None:
        self.assert_no_matches(FORBIDDEN_NAME_PATTERNS, "forbidden project name")

    def test_license_markers_are_absent(self) -> None:
        markers = [re.compile(re.escape(marker)) for marker in LICENSE_MARKERS]
        self.assert_no_matches(markers, "license marker")

    def test_secret_patterns_are_absent(self) -> None:
        self.assert_no_matches(SECRET_PATTERNS, "secret pattern")

    def test_local_tool_state_is_ignored_and_not_scanned(self) -> None:
        gitignore = read_text(repo_path(".gitignore"))
        dockerignore = read_text(repo_path(".dockerignore"))

        for directory in (
            ".agents",
            ".codex",
            ".idea",
            ".cache",
            ".mypy_cache",
            ".pytest_cache",
            ".ruff_cache",
            ".venv",
        ):
            with self.subTest(directory=directory):
                self.assertIn(f"{directory}/", gitignore)
                self.assertIn(directory, dockerignore)
                self.assertIn(directory, SKIP_DIRS)

    def assert_no_matches(self, patterns: list[re.Pattern[str]], label: str) -> None:
        failures: list[str] = []

        for path in iter_repo_text_files():
            text = read_text(path)
            for line_number, line in enumerate(text.splitlines(), start=1):
                if any(pattern.search(line) for pattern in patterns):
                    failures.append(f"{path}:{line_number}: {label}")

        if failures:
            self.fail("\n".join(failures))
