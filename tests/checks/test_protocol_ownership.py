from __future__ import annotations

import re
import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


MODULE_SPECIFIER_RE = re.compile(
    r"(?:import|export)\s+(?:type\s+)?(?:[^\"']*?\s+from\s+)?[\"']([^\"']+)[\"']"
    r"|import\s*\(\s*[\"']([^\"']+)[\"']\s*\)"
)


class ProtocolOwnershipTest(unittest.TestCase):
    def test_protocol_code_has_single_owners_and_package_import_boundaries(self) -> None:
        failures: list[str] = []

        for path in self.package_source_files():
            text = read_text(path)
            for specifier, line_number in self.module_specifiers(text):
                if specifier.startswith(".") and not self.relative_import_stays_in_package_src(path, specifier):
                    failures.append(f"{path}:{line_number}: package source relative imports must stay inside package src")
                if "/dist/" in specifier or specifier.endswith("/dist"):
                    failures.append(f"{path}:{line_number}: package source must not import built dist output")
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

    def test_cam_conformance_facets_keep_sourced_imports_isolated(self) -> None:
        allowed_imports_by_facet = {
            "bundle": {"@cam/protocol"},
            "manifest": {"@cam/protocol"},
            "resources": {"@cam/protocol"},
            "sourced": {"@cam/core", "@cam/protocol", "@cam/screen"},
        }
        failures: list[str] = []

        for path in sorted(repo_path("js/packages/cam-conformance/src").glob("**/*.ts")):
            relative = path.relative_to(repo_path("js/packages/cam-conformance/src"))
            facet = relative.parts[0]
            if facet in allowed_imports_by_facet:
                allowed_imports = allowed_imports_by_facet[facet]
            else:
                allowed_imports = set()

            for specifier, line_number in self.module_specifiers(read_text(path)):
                if not specifier.startswith("@cam/"):
                    continue
                if specifier not in allowed_imports:
                    failures.append(
                        f"{path}:{line_number}: conformance facet '{facet}' must not import {specifier}; "
                        f"allowed @cam imports: {self.format_allowed_imports(allowed_imports)}"
                    )

        if failures:
            self.fail("\n".join(failures))

    def package_source_files(self) -> list[Path]:
        return sorted(repo_path("js/packages").glob("*/src/**/*.ts"))

    def relative_import_stays_in_package_src(self, importer: Path, specifier: str) -> bool:
        package_name = importer.relative_to(repo_path("js/packages")).parts[0]
        package_src = repo_path("js/packages") / package_name / "src"
        target = (importer.parent / specifier).resolve()
        return target == package_src or package_src in target.parents

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
