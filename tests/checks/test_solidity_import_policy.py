from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
OZ_ALLOWED_TOP_LEVEL = {"access", "token", "utils"}
IMPORT_STATEMENT_RE = re.compile(r"\bimport\b(?P<body>[^;]*);", re.MULTILINE | re.DOTALL)
IMPORT_PATH_RE = re.compile(r'["\'](?P<path>[^"\']+)["\']')


class SolidityImportPolicyTest(unittest.TestCase):
    def test_contract_imports_are_relative_or_explicitly_allowed_dependencies(self) -> None:
        version = self.openzeppelin_version()
        failures: list[str] = []

        for path in iter_files("contracts/src", "contracts/test"):
            if path.suffix != ".sol":
                continue

            for import_path in self.import_paths(path):
                error = self.validate_import(path, import_path, version)
                if error is not None:
                    failures.append(error)

        if failures:
            self.fail("\n".join(failures))

    def test_import_policy_classifier_self_check(self) -> None:
        version = "5.6.1"
        source = repo_path("contracts/test/unit/HelloWorld.t.sol")

        self.assertIsNone(
            self.validate_import(source, f"{OZ_PACKAGE}-{version}/access/Ownable.sol", version)
        )
        self.assertIsNone(self.validate_import(source, "../../src/HelloWorld.sol", version))

        rejected = [
            f"{OZ_PACKAGE}-{version}/contracts/access/Ownable.sol",
            f"{OZ_PACKAGE}-5.4.0/access/Ownable.sol",
            "./Missing.sol",
            "forge-std/Test.sol",
            "https://example.test/Contract.sol",
        ]
        for import_path in rejected:
            with self.subTest(import_path=import_path):
                self.assertIsNotNone(self.validate_import(source, import_path, version))

    def openzeppelin_version(self) -> str:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
        dependency = config.get("dependencies", {}).get(OZ_PACKAGE)
        self.assertIsInstance(dependency, dict)
        version = dependency.get("version")
        self.assertIsInstance(version, str)
        return version

    def import_paths(self, path: Path) -> list[str]:
        imports: list[str] = []
        for statement in IMPORT_STATEMENT_RE.finditer(read_text(path)):
            matches = IMPORT_PATH_RE.findall(statement.group("body"))
            self.assertEqual(1, len(matches), f"{path}: malformed import statement")
            imports.append(matches[0])
        return imports

    def validate_import(self, source: Path, import_path: str, oz_version: str) -> str | None:
        if import_path.startswith(("./", "../")):
            return self.validate_relative_import(source, import_path)

        expected_prefix = f"{OZ_PACKAGE}-{oz_version}/"
        if import_path.startswith(OZ_PACKAGE):
            return self.validate_openzeppelin_import(source, import_path, expected_prefix)

        return f"{source}: disallowed package import {import_path}"

    def validate_relative_import(self, source: Path, import_path: str) -> str | None:
        if not import_path.endswith(".sol"):
            return f"{source}: relative import must target a Solidity file: {import_path}"

        resolved = (source.parent / import_path).resolve()
        contracts_root = repo_path("contracts").resolve()
        if resolved != contracts_root and contracts_root not in resolved.parents:
            return f"{source}: relative import escapes contracts/: {import_path}"

        if not resolved.is_file():
            return f"{source}: relative import target does not exist: {import_path}"

        return None

    def validate_openzeppelin_import(
        self,
        source: Path,
        import_path: str,
        expected_prefix: str,
    ) -> str | None:
        if not import_path.startswith(expected_prefix):
            return f"{source}: OpenZeppelin import must use {expected_prefix}: {import_path}"

        suffix = import_path.removeprefix(expected_prefix)
        parts = suffix.split("/")
        if len(parts) < 2 or parts[0] not in OZ_ALLOWED_TOP_LEVEL:
            allowed = ", ".join(sorted(OZ_ALLOWED_TOP_LEVEL))
            return f"{source}: OpenZeppelin import must stay within allowed roots ({allowed}): {import_path}"

        if "/contracts/" in import_path or suffix.startswith("contracts/"):
            return f"{source}: OpenZeppelin import uses source-repo layout instead of Soldeer layout: {import_path}"

        if any(part in {"", ".", ".."} for part in parts):
            return f"{source}: OpenZeppelin import contains an unsafe path segment: {import_path}"

        if not import_path.endswith(".sol"):
            return f"{source}: OpenZeppelin import must target a Solidity file: {import_path}"

        return None
