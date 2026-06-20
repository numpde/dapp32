from __future__ import annotations

import re
import unittest
from pathlib import Path

from .common import protocol_document_version, read_text, repo_path


MODULE_SPECIFIER_RE = re.compile(
    r"(?:import|export)\s+(?:type\s+)?(?:[^\"']*?\s+from\s+)?[\"']([^\"']+)[\"']"
    r"|import\s*\(\s*[\"']([^\"']+)[\"']\s*\)"
)
JS_TOOL_PACKAGE_ENTRYPOINT_RE = re.compile(r"^(?:\.\./)+packages/cam-[^/]+/dist/index\.js$")


class ProtocolOwnershipTest(unittest.TestCase):
    def test_protocol_code_has_single_owners_and_package_import_boundaries(self) -> None:
        failures: list[str] = []

        for path in [*self.package_source_files(), *self.app_source_files()]:
            text = read_text(path)
            for specifier, line_number in self.module_specifiers(text):
                if specifier.startswith(".") and not self.relative_import_stays_in_source_root(path, specifier):
                    failures.append(f"{path}:{line_number}: JS source relative imports must stay inside their source root")
                if "/dist/" in specifier or specifier.endswith("/dist"):
                    failures.append(f"{path}:{line_number}: JS source must not import built dist output")
                if specifier.startswith("@cam/") and len(specifier.split("/")) > 2:
                    failures.append(f"{path}:{line_number}: @cam package imports must use the public package root")

        forbidden_paths = [
            repo_path("js/packages/cam-core/src/inert-value.ts"),
            repo_path("js/packages/cam-screen/src/inert-value.ts"),
            repo_path("js/packages/cam-viewer/src/inert-value.ts"),
        ]

        existing = [str(path) for path in forbidden_paths if path.exists()]

        if existing:
            failures.append("inert value must live in js/packages/cam-protocol only:\n" + "\n".join(existing))

        version_owner = repo_path("js/packages/cam-protocol/src/versions.ts")
        version_definitions = {
            "CAM_VERSION": re.compile(r"\b(?:export\s+)?const\s+CAM_VERSION\b"),
            "UI_VERSION": re.compile(r"\b(?:export\s+)?const\s+UI_VERSION\b"),
        }

        for path in self.package_source_files():
            if path == version_owner:
                continue
            text = read_text(path)
            for name, pattern in version_definitions.items():
                if pattern.search(text):
                    failures.append(f"{path}: {name} must be defined only in {version_owner}")

        if failures:
            self.fail("\n".join(failures))

    def test_runtime_integer_representations_do_not_leak_past_evm_adapter(self) -> None:
        allowed = {
            repo_path("js/packages/cam-evm-viem/src/abi-values.ts"),
            repo_path("js/packages/cam-evm-viem/src/arguments.ts"),
            repo_path("js/packages/cam-evm-viem/src/chain.ts"),
            repo_path("js/packages/cam-evm-viem/src/routes.ts"),
        }
        failures: list[str] = []

        for path in self.package_source_files():
            if path in allowed:
                continue
            text = read_text(path)
            for line_number, line in enumerate(text.splitlines(), start=1):
                if re.search(r"\bbigint\b|BigInt\s*\(", line):
                    failures.append(
                        f"{path}:{line_number}: bigint is an EVM adapter runtime representation; "
                        "protocol packages must expose inert values instead"
                    )

        if failures:
            self.fail("\n".join(failures))

    def test_ts_test_fixtures_use_protocol_version_constants(self) -> None:
        failures: list[str] = []
        version_patterns = (
            re.compile(rf"(?<![A-Za-z0-9_$])[\"']?cam[\"']?\s*:\s*[\"']{re.escape(protocol_document_version('CAM_VERSION'))}[\"']"),
            re.compile(rf"(?<![A-Za-z0-9_$])[\"']?ui[\"']?\s*:\s*[\"']{re.escape(protocol_document_version('UI_VERSION'))}[\"']"),
        )

        for path in self.ts_test_fixture_files():
            if repo_path("js/packages") in path.parents and self.package_root(path).name == "cam-protocol":
                continue
            text = read_text(path)
            for pattern in version_patterns:
                for match in pattern.finditer(text):
                    line_number = text.count("\n", 0, match.start()) + 1
                    # Valid fixture documents should track the protocol package's
                    # exported version constants. Tests for explicitly invalid
                    # versions can still spell the wrong version literally.
                    failures.append(f"{path}:{line_number}: use CAM_VERSION/UI_VERSION from @cam/protocol in test fixtures")

        if failures:
            self.fail("\n".join(failures))

    def test_cam_conformance_facets_keep_sourced_imports_isolated(self) -> None:
        failures: list[str] = []

        for path in sorted(repo_path("js/packages/cam-conformance/src").glob("**/*.ts")):
            relative = path.relative_to(repo_path("js/packages/cam-conformance/src"))
            facet = relative.parts[0]
            # Only sourced/ is allowed to call into runtime parsers. Every
            # other conformance facet should stay granular and protocol-owned,
            # including future facets that do not exist yet.
            if facet == "sourced":
                allowed_imports = {"@cam/core", "@cam/protocol", "@cam/screen"}
            else:
                allowed_imports = {"@cam/protocol"}

            for specifier, line_number in self.module_specifiers(read_text(path)):
                if self.imports_conformance_sourced_facet(specifier) and facet != "bundle" and facet != "sourced":
                    failures.append(
                        f"{path}:{line_number}: conformance facet '{facet}' must not import sourced runtime checks; "
                        "route through the bundle orchestrator instead"
                    )
                if not specifier.startswith("@cam/"):
                    continue
                if specifier not in allowed_imports:
                    failures.append(
                        f"{path}:{line_number}: conformance facet '{facet}' must not import {specifier}; "
                        f"allowed @cam imports: {self.format_allowed_imports(allowed_imports)}"
                    )

        if failures:
            self.fail("\n".join(failures))

    def test_shared_ts_fixtures_do_not_become_hidden_package_clients(self) -> None:
        allowed_source_imports = {
            "../../../js/packages/cam-protocol/src/json.ts",
            "../../../js/packages/cam-protocol/src/resources.ts",
        }
        failures: list[str] = []

        for path in sorted(repo_path("tests/fixtures").glob("**/*.mts")):
            for specifier, line_number in self.module_specifiers(read_text(path)):
                if not specifier.startswith("../../../js/packages/"):
                    continue

                # Shared fixtures are compiled from multiple package test
                # projects, so they cannot rely on one package's local source
                # root. Keep the direct protocol imports limited to the JSON
                # and resource-policy primitives needed to discover checked-in
                # CAM resources; everything else should be a package test or a
                # real public package import.
                if specifier not in allowed_source_imports:
                    failures.append(
                        f"{path}:{line_number}: shared fixtures must not import package internals: {specifier}"
                    )

        if failures:
            self.fail("\n".join(failures))

    def test_package_tests_keep_cross_package_boundaries_explicit(self) -> None:
        failures: list[str] = []

        for path in self.package_test_files():
            for specifier, line_number in self.module_specifiers(read_text(path)):
                if not specifier.startswith("."):
                    continue

                target = (path.parent / specifier).resolve()
                if self.path_is_under(target, self.package_root(path)):
                    continue
                if self.path_is_under(target, repo_path("tests/fixtures")):
                    continue

                # Package tests may reach into their own package internals to
                # exercise boundary code, and they may share dapp fixtures from
                # tests/fixtures. A relative hop into a sibling package turns
                # that package's test tree into a hidden support package.
                failures.append(
                    f"{path}:{line_number}: package tests must not import relative paths outside their package "
                    "except tests/fixtures"
                )

        if failures:
            self.fail("\n".join(failures))

    def test_js_tools_consume_built_package_entrypoints(self) -> None:
        failures: list[str] = []

        for path in sorted(repo_path("js/tools").glob("**/*.ts")):
            for specifier, line_number in self.module_specifiers(read_text(path)):
                if specifier.startswith("@cam/"):
                    failures.append(f"{path}:{line_number}: JS tools must import built package entrypoints, not @cam package roots")
                    continue
                if "packages/cam-" not in specifier:
                    continue

                # Tools are checked as package-backed executables after the
                # library build. Importing dist/index.js keeps that boundary
                # visible and prevents tools from becoming another source-level
                # package graph with different type/runtime behavior.
                if not JS_TOOL_PACKAGE_ENTRYPOINT_RE.fullmatch(specifier):
                    failures.append(
                        f"{path}:{line_number}: JS tools must import package dist/index.js entrypoints: {specifier}"
                    )

        if failures:
            self.fail("\n".join(failures))

    def package_source_files(self) -> list[Path]:
        return sorted(repo_path("js/packages").glob("*/src/**/*.ts"))

    def package_test_files(self) -> list[Path]:
        return sorted(repo_path("js/packages").glob("*/test/**/*.ts"))

    def ts_test_fixture_files(self) -> list[Path]:
        return sorted([
            *self.package_test_files(),
            *repo_path("tests/fixtures").glob("**/*.mts"),
        ])

    def app_source_files(self) -> list[Path]:
        return sorted([
            *repo_path("js/apps").glob("*/src/**/*.ts"),
            *repo_path("js/apps").glob("*/src/**/*.tsx"),
        ])

    def relative_import_stays_in_source_root(self, importer: Path, specifier: str) -> bool:
        source_root = self.source_root(importer)
        target = (importer.parent / specifier).resolve()
        return target == source_root or source_root in target.parents

    def source_root(self, path: Path) -> Path:
        if repo_path("js/packages") in path.parents:
            return self.package_root(path) / "src"
        if repo_path("js/apps") in path.parents:
            app_name = path.relative_to(repo_path("js/apps")).parts[0]
            return repo_path("js/apps") / app_name / "src"

        raise AssertionError(f"unsupported JS source path: {path}")

    def package_root(self, path: Path) -> Path:
        package_name = path.relative_to(repo_path("js/packages")).parts[0]
        return repo_path("js/packages") / package_name

    def path_is_under(self, path: Path, root: Path) -> bool:
        return path == root or root in path.parents

    def imports_conformance_sourced_facet(self, specifier: str) -> bool:
        return "/sourced/" in specifier or specifier.startswith("../sourced/")

    def module_specifiers(self, text: str) -> list[tuple[str, int]]:
        specifiers: list[tuple[str, int]] = []
        for match in MODULE_SPECIFIER_RE.finditer(text):
            specifier = match.group(1) or match.group(2)
            if specifier is None:
                continue
            specifiers.append((specifier, text.count("\n", 0, match.start()) + 1))

        return specifiers

    def format_allowed_imports(self, allowed_imports: set[str]) -> str:
        if not allowed_imports:
            return "none"
        return ", ".join(sorted(allowed_imports))
