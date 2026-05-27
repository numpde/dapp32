from __future__ import annotations

import re
import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


MODULE_SPECIFIER_RE = re.compile(
    r"(?:import|export)\s+(?:type\s+)?(?:[^\"']*?\s+from\s+)?[\"']([^\"']+)[\"']"
    r"|import\s*\(\s*[\"']([^\"']+)[\"']\s*\)"
)
PROTOCOL_VERSION_LITERAL_RE = re.compile(r"[\"'][0-9]+\.[0-9]+\.[0-9]+[\"']")
ABI_INSPECT_TARGET_RE = re.compile(r"^[A-Za-z0-9_-]+/src/[A-Za-z_][A-Za-z0-9_]*\.sol:[A-Za-z_][A-Za-z0-9_]*$")


class ProtocolOwnershipTest(unittest.TestCase):
    def test_package_source_uses_package_import_boundaries(self) -> None:
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

        if failures:
            self.fail("\n".join(failures))

    def test_package_relative_import_boundary_self_check(self) -> None:
        importer = repo_path("packages/cam-core/src/nested/example.ts")

        self.assertTrue(self.relative_import_stays_in_package_src(importer, "../errors.ts"))
        self.assertTrue(self.relative_import_stays_in_package_src(importer, "./local.ts"))
        self.assertFalse(self.relative_import_stays_in_package_src(importer, "../../package.json"))
        self.assertFalse(self.relative_import_stays_in_package_src(importer, "../../../cam-screen/src/index.ts"))

    def test_protocol_versions_have_package_source_owners(self) -> None:
        self.assert_literal_pattern_only_in_paths(
            PROTOCOL_VERSION_LITERAL_RE,
            roots=("packages",),
            allowed_paths={
                repo_path("packages/cam-core/src/constants.ts"),
                repo_path("packages/cam-screen/src/constants.ts"),
            },
        )

    def test_javascript_code_uses_owned_json_parsers(self) -> None:
        self.assert_literal_only_in_paths(
            "JSON." + "parse",
            roots=("containers", "packages", "tests", "tools"),
            allowed_paths={
                repo_path("containers/node-deps/stage-package-workspace"),
                repo_path("packages/cam-protocol/src/json.ts"),
            },
        )

    def test_viewer_terminal_entrypoint_is_backend_neutral(self) -> None:
        entrypoint = repo_path("tools/viewer-terminal/terminal-session.ts")
        text = read_text(entrypoint)

        for forbidden in (
            "bike",
            "BIKE",
            "mock",
            "MOCK",
            "tests/fixtures",
            "file:///work/dapps",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, text, f"{entrypoint}: backend details belong under tools/viewer-terminal/backends/")

    def test_python_json_parsing_is_explicitly_strict(self) -> None:
        failures: list[str] = []

        for path in iter_files("containers", "tests", "tools"):
            if path.suffix != ".py":
                continue

            for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                if "json.loads(" in line and "parse_constant=" not in line:
                    failures.append(f"{path}:{line_number}: json.loads must reject NaN/Infinity with parse_constant")

        if failures:
            self.fail("\n".join(failures))

    def test_null_prototype_maps_are_protocol_owned(self) -> None:
        self.assert_literal_only_in_paths(
            "Object.create(null)",
            roots=("packages",),
            allowed_paths={
                repo_path("packages/cam-protocol/src/inert-value.ts"),
                repo_path("packages/cam-protocol/src/json.ts"),
            },
        )

    def test_inert_value_has_one_runtime_owner(self) -> None:
        forbidden_paths = [
            repo_path("packages/cam-core/src/inert-value.ts"),
            repo_path("packages/cam-screen/src/inert-value.ts"),
            repo_path("packages/cam-viewer/src/inert-value.ts"),
        ]

        existing = [str(path) for path in forbidden_paths if path.exists()]

        if existing:
            self.fail("inert value must live in packages/cam-protocol only:\n" + "\n".join(existing))

    def test_screen_schema_is_not_reimplemented_as_a_python_check(self) -> None:
        old_python_schema = repo_path("tests/checks/cam_screen_schema.py")
        if old_python_schema.exists():
            self.fail(f"screen schema validation must stay in packages/cam-screen: {old_python_schema}")

        for literal in (
            "SCREEN_" + "ELEMENT_KEYS",
            "SCREEN_" + "TOP_LEVEL_KEYS",
            "ELEMENT_KEYS_" + "BY_TYPE",
        ):
            with self.subTest(literal=literal):
                self.assert_literal_only_in_paths(literal, roots=("tests/checks",), allowed_paths=set())

    def test_abi_export_consumes_path_qualified_inspect_targets(self) -> None:
        compose = read_text(repo_path("compose/forge.yml"))
        self.assertIn('while IFS="\t" read -r dapp inspect_target abi_name', compose)
        self.assertIn('forge inspect --json "$$inspect_target" abi', compose)
        self.assertNotRegex(compose, r"forge inspect\s+(?:--json\s+)?[\"']\$\$(?:contract|contract_name|abi_name)[\"']")

    def test_abi_export_plan_targets_are_path_qualified(self) -> None:
        from tools.cam_abi_plan import build_abi_plan_rows

        failures = [
            f"{row.dapp}: invalid Forge inspect target: {row.inspect_target}"
            for row in build_abi_plan_rows(repo_path("dapps"))
            if ABI_INSPECT_TARGET_RE.fullmatch(row.inspect_target) is None
        ]

        if failures:
            self.fail("\n".join(failures))

    def assert_literal_only_in_paths(
        self,
        literal: str,
        *,
        roots: tuple[str, ...],
        allowed_paths: set[Path],
    ) -> None:
        failures: list[str] = []

        for path in iter_files(*roots):
            if path.suffix not in {".cts", ".js", ".mts", ".py", ".sh", ".ts"} and path.name not in {"stage-package-workspace"}:
                continue

            if path in allowed_paths:
                continue

            for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                if literal in line:
                    failures.append(f"{path}:{line_number}: unexpected {literal!r}")

        if failures:
            self.fail("\n".join(failures))

    def assert_literal_pattern_only_in_paths(
        self,
        pattern: re.Pattern[str],
        *,
        roots: tuple[str, ...],
        allowed_paths: set[Path],
    ) -> None:
        failures: list[str] = []

        for path in iter_files(*roots):
            if path.suffix != ".ts" or "/src/" not in path.as_posix():
                continue

            if path in allowed_paths:
                continue

            for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                if pattern.search(line):
                    failures.append(f"{path}:{line_number}: unexpected protocol version literal")

        if failures:
            self.fail("\n".join(failures))

    def package_source_files(self) -> list[Path]:
        return sorted(repo_path("packages").glob("*/src/**/*.ts"))

    def relative_import_stays_in_package_src(self, importer: Path, specifier: str) -> bool:
        package_name = importer.relative_to(repo_path("packages")).parts[0]
        package_src = repo_path("packages") / package_name / "src"
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
