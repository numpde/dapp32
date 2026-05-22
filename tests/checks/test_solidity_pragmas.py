from __future__ import annotations

import re
import tomllib
import unittest

from .common import iter_files, read_text, repo_path


PRAGMA_RE = re.compile(r"^\s*pragma\s+solidity\s+([^;]+);", re.MULTILINE)


class SolidityPragmaTest(unittest.TestCase):
    def test_repo_solidity_pragmas_match_foundry_compiler(self) -> None:
        expected = self.foundry_solc_version()

        for path in iter_files("contracts", "examples"):
            if path.suffix != ".sol":
                continue

            with self.subTest(path=str(path)):
                match = PRAGMA_RE.search(read_text(path))
                self.assertIsNotNone(match, f"{path}: missing Solidity pragma")
                assert match is not None
                actual = match.group(1).strip()
                self.assertEqual(
                    expected,
                    actual,
                    f"{path}: expected pragma solidity {expected}; got pragma solidity {actual};",
                )

    def foundry_solc_version(self) -> str:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
        solc = config["profile"]["default"]["solc"]
        self.assertIsInstance(solc, str)
        return solc
