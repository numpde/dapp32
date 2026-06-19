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

    def package_source_files(self) -> list[Path]:
        return sorted(repo_path("js/packages").glob("*/src/**/*.ts"))

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
            package_name = path.relative_to(repo_path("js/packages")).parts[0]
            return repo_path("js/packages") / package_name / "src"
        if repo_path("js/apps") in path.parents:
            app_name = path.relative_to(repo_path("js/apps")).parts[0]
            return repo_path("js/apps") / app_name / "src"

        raise AssertionError(f"unsupported JS source path: {path}")

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
