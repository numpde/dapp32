from __future__ import annotations

import re
import tomllib
import unittest
from unittest.mock import patch

from .common import SERVICE_PAYMENT_SNAPSHOT_ROOT, first_party_solidity_files, read_text, repo_path


PRAGMA_RE = re.compile(r"^\s*pragma\s+solidity\s+([^;]+);", re.MULTILINE)


class SolidityPragmaTest(unittest.TestCase):
    def test_research_exclusion_preserves_adjacent_first_party_sources(self) -> None:
        reference = SERVICE_PAYMENT_SNAPSHOT_ROOT / "example.sol"
        adjacent = SERVICE_PAYMENT_SNAPSHOT_ROOT.parent / "Owned.sol"
        source = repo_path("dapps/pay-to-play/src/Payments.sol")
        with patch("tests.checks.common.iter_files", return_value=[reference, adjacent, source]):
            self.assertEqual([adjacent, source], first_party_solidity_files())

    def test_foundry_excludes_only_the_research_collection(self) -> None:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        relative = SERVICE_PAYMENT_SNAPSHOT_ROOT.relative_to(repo_path("dapps"))
        self.assertEqual([relative.as_posix() + "/**"], config["profile"]["default"]["skip"])

    def test_repo_solidity_pragmas_match_foundry_compiler(self) -> None:
        expected = self.foundry_solc_version()

        for path in first_party_solidity_files():
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
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        solc = config["profile"]["default"]["solc"]
        self.assertIsInstance(solc, str)
        return solc
