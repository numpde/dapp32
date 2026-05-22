from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
OZ_ALLOWED_TOP_LEVEL = {"access", "utils"}
FORGE_STD_PACKAGE = "forge-std"
FORGE_STD_ALLOWED_TEST_IMPORTS = {"Test.sol"}
IMPORT_STATEMENT_RE = re.compile(r"\bimport\b(?P<body>[^;]*);", re.MULTILINE | re.DOTALL)
IMPORT_PATH_RE = re.compile(r'["\'](?P<path>[^"\']+)["\']')


class SolidityImportPolicyTest(unittest.TestCase):
    def test_contract_imports_are_relative_or_explicitly_allowed_dependencies(self) -> None:
        dependency_versions = self.dependency_versions()
        failures: list[str] = []

        for path in iter_files("dapps/deposit/src", "dapps/deposit/test"):
            if path.suffix != ".sol":
                continue

            for import_path in self.import_paths(path):
                error = self.validate_import(path, import_path, dependency_versions)
                if error is not None:
                    failures.append(error)

        if failures:
            self.fail("\n".join(failures))

    def test_openzeppelin_allowlist_matches_current_import_surface(self) -> None:
        version = self.dependency_versions()[OZ_PACKAGE]
        expected_prefix = f"{OZ_PACKAGE}-{version}/"
        imported_roots: set[str] = set()

        for path in iter_files("dapps/deposit/src", "dapps/deposit/test"):
            if path.suffix != ".sol":
                continue

            for import_path in self.import_paths(path):
                if import_path.startswith(expected_prefix):
                    suffix = import_path.removeprefix(expected_prefix)
                    imported_roots.add(suffix.split("/", maxsplit=1)[0])

        self.assertTrue(imported_roots, "expected first-party contracts to import OpenZeppelin")
        self.assertEqual(
            imported_roots,
            OZ_ALLOWED_TOP_LEVEL,
            "OpenZeppelin import allowlist should match the current first-party import surface",
        )

    def test_import_policy_classifier_self_check(self) -> None:
        dependency_versions = {
            OZ_PACKAGE: "5.6.1",
            FORGE_STD_PACKAGE: "1.12.0",
        }
        source = repo_path("dapps/deposit/test/unit/HelloWorld/HelloWorld.t.sol")

        self.assertIsNone(
            self.validate_import(source, f"{OZ_PACKAGE}-5.6.1/access/Ownable.sol", dependency_versions)
        )
        self.assertIsNone(
            self.validate_import(source, f"{OZ_PACKAGE}-5.6.1/utils/Pausable.sol", dependency_versions)
        )
        self.assertIsNone(self.validate_import(source, "../../../src/HelloWorld.sol", dependency_versions))
        self.assertIsNone(self.validate_import(source, "forge-std-1.12.0/src/Test.sol", dependency_versions))

        rejected = [
            f"{OZ_PACKAGE}-5.6.1/contracts/access/Ownable.sol",
            f"{OZ_PACKAGE}-5.6.1/token/ERC20/IERC20.sol",
            f"{OZ_PACKAGE}-5.4.0/access/Ownable.sol",
            "./Missing.sol",
            "forge-std/Test.sol",
            "forge-std-1.11.1/src/Test.sol",
            "forge-std-1.12.0/src/Script.sol",
            "https://example.test/Contract.sol",
        ]
        for import_path in rejected:
            with self.subTest(import_path=import_path):
                self.assertIsNotNone(self.validate_import(source, import_path, dependency_versions))

    def dependency_versions(self) -> dict[str, str]:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        dependencies = config.get("dependencies", {})
        self.assertIsInstance(dependencies, dict)

        versions: dict[str, str] = {}
        for package in (OZ_PACKAGE, FORGE_STD_PACKAGE):
            dependency = dependencies.get(package)
            self.assertIsInstance(dependency, dict)
            version = dependency.get("version")
            self.assertIsInstance(version, str)
            versions[package] = version

        return versions

    def import_paths(self, path: Path) -> list[str]:
        imports: list[str] = []
        for statement in IMPORT_STATEMENT_RE.finditer(read_text(path)):
            matches = IMPORT_PATH_RE.findall(statement.group("body"))
            self.assertEqual(1, len(matches), f"{path}: malformed import statement")
            imports.append(matches[0])
        return imports

    def validate_import(self, source: Path, import_path: str, dependency_versions: dict[str, str]) -> str | None:
        if import_path.startswith(("./", "../")):
            return self.validate_relative_import(source, import_path)

        expected_prefix = f"{OZ_PACKAGE}-{dependency_versions[OZ_PACKAGE]}/"
        if import_path.startswith(OZ_PACKAGE):
            return self.validate_openzeppelin_import(source, import_path, expected_prefix)

        if import_path.startswith(FORGE_STD_PACKAGE):
            return self.validate_forge_std_import(source, import_path, dependency_versions[FORGE_STD_PACKAGE])

        return f"{source}: disallowed package import {import_path}"

    def validate_relative_import(self, source: Path, import_path: str) -> str | None:
        if not import_path.endswith(".sol"):
            return f"{source}: relative import must target a Solidity file: {import_path}"

        resolved = (source.parent / import_path).resolve()
        contracts_root = repo_path("dapps/deposit").resolve()
        if resolved != contracts_root and contracts_root not in resolved.parents:
            return f"{source}: relative import escapes dapps/deposit/: {import_path}"

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

    def validate_forge_std_import(self, source: Path, import_path: str, version: str) -> str | None:
        if not self.is_test_source(source):
            return f"{source}: forge-std imports are allowed only in Solidity tests: {import_path}"

        expected_prefix = f"{FORGE_STD_PACKAGE}-{version}/src/"
        if not import_path.startswith(expected_prefix):
            return f"{source}: forge-std import must use {expected_prefix}: {import_path}"

        suffix = import_path.removeprefix(expected_prefix)
        if suffix not in FORGE_STD_ALLOWED_TEST_IMPORTS:
            allowed = ", ".join(sorted(FORGE_STD_ALLOWED_TEST_IMPORTS))
            return f"{source}: forge-std import must be one of ({allowed}): {import_path}"

        return None

    def is_test_source(self, source: Path) -> bool:
        relative = source.resolve().relative_to(repo_path("").resolve())
        return "test" in relative.parts
