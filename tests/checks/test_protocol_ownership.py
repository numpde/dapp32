from __future__ import annotations

import unittest
from pathlib import Path

from .common import iter_files, read_text, repo_path


class ProtocolOwnershipTest(unittest.TestCase):
    def test_package_code_uses_protocol_json_parser(self) -> None:
        self.assert_literal_only_in_paths(
            "JSON.parse",
            roots=("packages",),
            allowed_paths={repo_path("packages/cam-protocol/src/json.ts")},
        )

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

    def assert_literal_only_in_paths(
        self,
        literal: str,
        *,
        roots: tuple[str, ...],
        allowed_paths: set[Path],
    ) -> None:
        failures: list[str] = []

        for path in iter_files(*roots):
            if path.suffix not in {".py", ".ts", ".js", ".sh"} and path.name not in {"stage-package-workspace"}:
                continue

            if path in allowed_paths:
                continue

            for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                if literal in line:
                    failures.append(f"{path}:{line_number}: unexpected {literal!r}")

        if failures:
            self.fail("\n".join(failures))
