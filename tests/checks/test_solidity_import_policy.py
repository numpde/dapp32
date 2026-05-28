from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
OZ_ALLOWED_TOP_LEVEL = {
    OZ_PACKAGE: {"access", "token", "utils"},
}
FORGE_STD_PACKAGE = "forge-std"
FORGE_STD_ALLOWED_TEST_IMPORTS = {"Test.sol"}
FORGE_STD_ALLOWED_SCRIPT_IMPORTS = {"Script.sol"}
DEPENDENCY_PACKAGES = (OZ_PACKAGE, FORGE_STD_PACKAGE)
IMPORT_STATEMENT_RE = re.compile(r"^\s*import\b(?P<body>[^;]*);", re.MULTILINE | re.DOTALL)
IMPORT_PATH_RE = re.compile(r'["\'](?P<path>[^"\']+)["\']')


class SolidityImportPolicyTest(unittest.TestCase):
    def test_contract_imports_are_relative_or_explicitly_allowed_dependencies(self) -> None:
        dependency_versions = self.dependency_versions()
        failures: list[str] = []

        for path in self.dapp_solidity_files():
            if path.suffix != ".sol":
                continue

            for import_path in self.import_paths(path):
                error = self.validate_import(path, import_path, dependency_versions)
                if error is not None:
                    failures.append(error)

        if failures:
            self.fail("\n".join(failures))

    def dependency_versions(self) -> dict[str, str]:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        dependencies = config.get("dependencies")
        self.assertIsInstance(dependencies, dict, "foundry.toml must declare [dependencies]")

        versions: dict[str, str] = {}
        for package in DEPENDENCY_PACKAGES:
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

    def dapp_solidity_files(self) -> list[Path]:
        return [path for path in iter_files("dapps") if path.suffix == ".sol"]

    def validate_import(self, source: Path, import_path: str, dependency_versions: dict[str, str]) -> str | None:
        if import_path.startswith(("./", "../")):
            return self.validate_relative_import(source, import_path)

        for package in sorted(OZ_ALLOWED_TOP_LEVEL, key=len, reverse=True):
            expected_prefix = f"{package}-{dependency_versions[package]}/"
            if import_path.startswith(package):
                return self.validate_openzeppelin_import(source, import_path, package, expected_prefix)

        if import_path.startswith(FORGE_STD_PACKAGE):
            return self.validate_forge_std_import(source, import_path, dependency_versions[FORGE_STD_PACKAGE])

        if self.is_script_source(source) and import_path == "cam/src/CamRoot.sol":
            return self.validate_dapps_root_import(source, import_path)

        return f"{source}: disallowed package import {import_path}"

    def validate_relative_import(self, source: Path, import_path: str) -> str | None:
        if not import_path.endswith(".sol"):
            return f"{source}: relative import must target a Solidity file: {import_path}"

        resolved = (source.parent / import_path).resolve()
        dapp_root = self.dapp_root_for(source)
        if resolved != dapp_root and dapp_root not in resolved.parents:
            return f"{source}: relative import escapes {dapp_root.relative_to(repo_path(''))}/: {import_path}"

        if not resolved.is_file():
            return f"{source}: relative import target does not exist: {import_path}"

        return None

    def validate_openzeppelin_import(
        self,
        source: Path,
        import_path: str,
        package: str,
        expected_prefix: str,
    ) -> str | None:
        if not import_path.startswith(expected_prefix):
            return f"{source}: {package} import must use {expected_prefix}: {import_path}"

        suffix = import_path.removeprefix(expected_prefix)
        parts = suffix.split("/")
        if len(parts) < 2 or parts[0] not in OZ_ALLOWED_TOP_LEVEL[package]:
            allowed = ", ".join(sorted(OZ_ALLOWED_TOP_LEVEL[package]))
            return f"{source}: {package} import must stay within allowed roots ({allowed}): {import_path}"

        if "/contracts/" in import_path or suffix.startswith("contracts/"):
            return f"{source}: {package} import uses source-repo layout instead of Soldeer layout: {import_path}"

        if any(part in {"", ".", ".."} for part in parts):
            return f"{source}: {package} import contains an unsafe path segment: {import_path}"

        if not import_path.endswith(".sol"):
            return f"{source}: {package} import must target a Solidity file: {import_path}"

        return None

    def validate_forge_std_import(self, source: Path, import_path: str, version: str) -> str | None:
        expected_prefix = f"{FORGE_STD_PACKAGE}-{version}/src/"
        if not import_path.startswith(expected_prefix):
            return f"{source}: forge-std import must use {expected_prefix}: {import_path}"

        suffix = import_path.removeprefix(expected_prefix)
        if self.is_test_source(source):
            allowed_imports = FORGE_STD_ALLOWED_TEST_IMPORTS
        elif self.is_script_source(source):
            allowed_imports = FORGE_STD_ALLOWED_SCRIPT_IMPORTS
        else:
            return f"{source}: forge-std imports are allowed only in Solidity tests or scripts: {import_path}"

        if suffix not in allowed_imports:
            allowed = ", ".join(sorted(allowed_imports))
            return f"{source}: forge-std import must be one of ({allowed}): {import_path}"

        return None

    def validate_dapps_root_import(self, source: Path, import_path: str) -> str | None:
        if not import_path.endswith(".sol"):
            return f"{source}: dapps-root import must target a Solidity file: {import_path}"
        if any(part in {"", ".", ".."} for part in import_path.split("/")):
            return f"{source}: dapps-root import contains an unsafe path segment: {import_path}"

        resolved = (repo_path("dapps") / import_path).resolve()
        dapps_root = repo_path("dapps").resolve()
        if resolved != dapps_root and dapps_root not in resolved.parents:
            return f"{source}: dapps-root import escapes dapps/: {import_path}"
        if not resolved.is_file():
            return f"{source}: dapps-root import target does not exist: {import_path}"

        return None

    def is_test_source(self, source: Path) -> bool:
        relative = source.resolve().relative_to(repo_path("").resolve())
        return len(relative.parts) >= 4 and relative.parts[0] == "dapps" and relative.parts[2] == "test"

    def is_script_source(self, source: Path) -> bool:
        relative = source.resolve().relative_to(repo_path("").resolve())
        return len(relative.parts) >= 4 and relative.parts[0] == "dapps" and relative.parts[2] == "script"

    def dapp_root_for(self, source: Path) -> Path:
        relative = source.resolve().relative_to(repo_path("").resolve())
        self.assertGreaterEqual(len(relative.parts), 2, f"{source}: expected dapps/<name>/... path")
        self.assertEqual("dapps", relative.parts[0], f"{source}: expected dapps/<name>/... path")
        return repo_path(f"dapps/{relative.parts[1]}").resolve()
