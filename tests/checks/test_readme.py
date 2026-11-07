from __future__ import annotations

import unittest

from .common import read_text, repo_path


class ReadmeTest(unittest.TestCase):
    def test_root_readme_stays_a_short_entry_point(self) -> None:
        # Count all whitespace-separated words, including headings and links.
        # Neither the wording nor the Markdown's line wrapping is prescribed.
        words = len(read_text(repo_path("README.md")).split())
        self.assertLessEqual(
            words,
            250,
            f"README.md has {words} words (limit: 250). Keep the overview and "
            "documentation links here; move operational guidance into the published docs.",
        )
