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
CAM_CONFORMANCE_RULE_KEY_RE = re.compile(r"^\s*[\"']?(CAM_[A-Z0-9_]+)[\"']?:\s*\{$", re.MULTILINE)
CAM_CONFORMANCE_RULE_CLASS_RE = re.compile(r"(?:\bclass|[\"']class[\"'])\s*:\s*[\"'](?P<class>[ABC])[\"']")
CAM_CONFORMANCE_RULE_PROPERTY_RE = re.compile(r"(?:\brule|[\"']rule[\"'])\s*:\s*(?P<expr>[^,\n]+)")
CAM_CONFORMANCE_RULE_DESCRIPTOR_RE = re.compile(
    r"^\s*[\"']?(?P<rule>CAM_[A-Z0-9_]+)[\"']?:\s*\{(?P<body>.*?)(?=^\s*[\"']?CAM_[A-Z0-9_]+[\"']?:\s*\{|\n\s*\}\s*\))",
    re.MULTILINE | re.DOTALL,
)
TS_STRING_PROPERTY_RE = r"(?:\b{name}|[\"']{name}[\"'])\s*:\s*[\"'](?P<value>[^\"']*)[\"']"
ABI_DYNAMIC_ARRAY_SYNTAX_RE = re.compile(r"\.endsWith\(\s*[\"']\[\][\"']\s*\)|\btype\.slice\(\s*0,\s*-2\s*\)")
EXPRESSION_SYNTAX_MESSAGE_RE = re.compile(r"invalid expression syntax:")
PROTOCOL_FACT_EXPORT_RE = re.compile(
    r"\b(?:collectCam[A-Za-z]+Facts?|collectCamRouteExpressionDiagnostics|CamFact(?:Diagnostic(?:Code)?|Result)|Cam[A-Za-z]+Fact)\b"
)


class ProtocolOwnershipTest(unittest.TestCase):
    def test_protocol_code_has_single_owners_and_package_import_boundaries(self) -> None:
        failures: list[str] = []
        source_files = [*self.package_source_files(), *self.app_source_files()]
        package_boundary_files = [*source_files, *self.package_test_files()]

        for path in source_files:
            text = read_text(path)
            for specifier, line_number in self.module_specifiers(text):
                if specifier.startswith(".") and not self.relative_import_stays_in_source_root(path, specifier):
                    failures.append(f"{path}:{line_number}: JS source relative imports must stay inside their source root")

        for path in package_boundary_files:
            text = read_text(path)
            for specifier, line_number in self.module_specifiers(text):
                if "/dist/" in specifier or specifier.endswith("/dist"):
                    failures.append(f"{path}:{line_number}: JS source/tests must not import built dist output")
                if specifier.startswith("@cam/") and len(specifier.split("/")) > 2:
                    failures.append(f"{path}:{line_number}: @cam package imports must use the public package root")

        protocol_owned_modules = {
            "inert value": [
                repo_path("js/packages/cam-core/src/inert-value.ts"),
                repo_path("js/packages/cam-screen/src/inert-value.ts"),
                repo_path("js/packages/cam-viewer/src/inert-value.ts"),
            ],
            "protocol constants": [
                repo_path("js/packages/cam-core/src/constants.ts"),
                repo_path("js/packages/cam-screen/src/constants.ts"),
            ],
            "resource URI resolution": [
                repo_path("js/packages/cam-core/src/uri.ts"),
            ],
        }

        for label, forbidden_paths in protocol_owned_modules.items():
            existing = [str(path) for path in forbidden_paths if path.exists()]
            if existing:
                failures.append(f"{label} must live in js/packages/cam-protocol only:\n" + "\n".join(existing))

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

    def test_protocol_owned_syntax_helpers_are_not_reimplemented(self) -> None:
        owners = (
            (
                "ABI dynamic array syntax",
                {repo_path("js/packages/cam-protocol/src/abi-types.ts")},
                ABI_DYNAMIC_ARRAY_SYNTAX_RE,
                "use abiDynamicArrayElementType from @cam/protocol",
            ),
            (
                "expression syntax diagnostics",
                {repo_path("js/packages/cam-protocol/src/expressions.ts")},
                EXPRESSION_SYNTAX_MESSAGE_RE,
                "use expressionReferenceSyntaxError from @cam/protocol",
            ),
        )
        failures: list[str] = []

        for path in self.package_source_files():
            text = read_text(path)
            for label, allowed, pattern, message in owners:
                if path in allowed:
                    continue

                for match in pattern.finditer(text):
                    line_number = text.count("\n", 0, match.start()) + 1
                    failures.append(f"{path}:{line_number}: {label} is protocol-owned; {message}")

        if failures:
            self.fail("\n".join(failures))

    def test_protocol_facts_stay_root_exported_and_narrowly_consumed(self) -> None:
        allowed_consumers = {"cam-protocol", "cam-core", "cam-conformance"}
        failures: list[str] = []

        for path in [
            *self.package_source_files(),
            *self.package_test_files(),
            *self.app_source_files(),
            *self.tool_source_files(),
            *self.shared_fixture_files(),
        ]:
            text = read_text(path)
            package_name = ""
            if repo_path("js/packages") in path.parents:
                package_name = self.package_root(path).name
            imports_protocol_root = False
            for specifier, line_number in self.module_specifiers(text):
                if specifier.startswith("@cam/protocol/"):
                    failures.append(f"{path}:{line_number}: protocol facts must be consumed through @cam/protocol root exports")
                if specifier == "@cam/protocol":
                    imports_protocol_root = True
                if self.imports_protocol_tool_entrypoint(specifier):
                    imports_protocol_root = True
                if specifier != "@cam/protocol" and not self.relative_import_resolves_to_protocol_facts(path, specifier):
                    continue
                if not PROTOCOL_FACT_EXPORT_RE.search(self.import_statement_at_line(text, line_number)):
                    continue
                if package_name not in allowed_consumers:
                    failures.append(
                        f"{path}:{line_number}: protocol facts are provisional; "
                        f"allowed consumers: {', '.join(sorted(allowed_consumers))}"
                    )
            if package_name not in allowed_consumers and imports_protocol_root:
                match = PROTOCOL_FACT_EXPORT_RE.search(text)
                if match is not None:
                    line_number = text.count("\n", 0, match.start()) + 1
                    failures.append(
                        f"{path}:{line_number}: protocol facts are provisional; "
                        f"allowed consumers: {', '.join(sorted(allowed_consumers))}"
                    )

        if failures:
            self.fail("\n".join(failures))

    def test_protocol_fact_guard_covers_current_provisional_surface(self) -> None:
        guarded_symbols = (
            "collectCamRootFact",
            "collectCamNamespaceFacts",
            "collectCamResourceDeclarationFacts",
            "collectCamInvocationFact",
            "collectCamRouteInputsFact",
            "collectCamRouteExpressionDiagnostics",
            "CamFactDiagnostic",
            "CamFactDiagnosticCode",
            "CamFactResult",
            "CamRootFact",
            "CamNamespaceFact",
            "CamResourceDeclarationFact",
            "CamInvocationFact",
            "CamRouteInputsFact",
        )
        for symbol in guarded_symbols:
            with self.subTest(symbol=symbol):
                self.assertRegex(symbol, PROTOCOL_FACT_EXPORT_RE)

        ordinary_protocol_symbols = (
            "collectExpressionReferences",
            "createExpressionRuntime",
            "CAM_ROUTE_CONTEXT_KEYS",
            "parseJsonText",
        )
        for symbol in ordinary_protocol_symbols:
            with self.subTest(symbol=symbol):
                self.assertNotRegex(symbol, PROTOCOL_FACT_EXPORT_RE)

    def test_ts_test_fixtures_use_protocol_version_constants(self) -> None:
        failures: list[str] = []

        for path in self.ts_test_fixture_files():
            if repo_path("js/packages") in path.parents and self.package_root(path).name == "cam-protocol":
                continue
            text = read_text(path)
            for pattern in self.current_protocol_version_fixture_patterns():
                for match in pattern.finditer(text):
                    line_number = text.count("\n", 0, match.start()) + 1
                    # Valid fixture documents should track the protocol package's
                    # exported version constants. Tests for explicitly invalid
                    # versions can still spell the wrong version literally.
                    failures.append(f"{path}:{line_number}: use CAM_VERSION/UI_VERSION from @cam/protocol in test fixtures")

        if failures:
            self.fail("\n".join(failures))

    def test_protocol_version_fixture_patterns_match_current_fixture_shapes(self) -> None:
        patterns = self.current_protocol_version_fixture_patterns()
        cam_version = protocol_document_version("CAM_VERSION")
        ui_version = protocol_document_version("UI_VERSION")

        self.assertTrue(any(pattern.search(f'const cam = {{ cam: "{cam_version}" }}') for pattern in patterns))
        self.assertTrue(any(pattern.search(f'const cam = {{ "cam": "{cam_version}" }}') for pattern in patterns))
        self.assertTrue(any(pattern.search(f"const ui = {{ 'ui': '{ui_version}' }}") for pattern in patterns))
        self.assertFalse(any(pattern.search('const cam = { cam: "2.0.0" }') for pattern in patterns))
        self.assertFalse(any(pattern.search(f'const value = {{ camera: "{cam_version}" }}') for pattern in patterns))

    def test_cam_conformance_facets_stay_protocol_owned(self) -> None:
        failures: list[str] = []

        for path in sorted(repo_path("js/packages/cam-conformance/src").glob("**/*.ts")):
            relative = path.relative_to(repo_path("js/packages/cam-conformance/src"))
            facet = relative.parts[0]
            # Conformance should stay protocol-owned. Runtime parser acceptance
            # belongs in the owning runtime package tests, not as fallback
            # diagnostics here.
            allowed_imports = {"@cam/protocol"}

            for specifier, line_number in self.module_specifiers(read_text(path)):
                if self.imports_conformance_sourced_facet(specifier) and facet != "bundle" and facet != "sourced":
                    failures.append(
                        f"{path}:{line_number}: conformance facet '{facet}' must not import sourced byte normalization; "
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

    def test_cam_conformance_rules_are_structural_and_unique(self) -> None:
        failures: list[str] = []
        rule_locations: dict[str, list[str]] = {}
        validated_rules: set[str] = set()

        for path in sorted(repo_path("js/packages/cam-conformance/src").glob("**/*.ts")):
            text = read_text(path)
            lines = text.splitlines()
            for match in CAM_CONFORMANCE_RULE_KEY_RE.finditer(text):
                line_number = text.count("\n", 0, match.start()) + 1
                rule = match.group(1)
                if rule not in rule_locations:
                    rule_locations[rule] = []
                rule_locations[rule].append(f"{path}:{line_number}")

            for match in CAM_CONFORMANCE_RULE_CLASS_RE.finditer(text):
                line_number = text.count("\n", 0, match.start()) + 1
                stripped = lines[line_number - 1].lstrip()
                if not stripped.startswith(("class", "\"class\"", "'class'")):
                    continue
                if match.group("class") != "C":
                    continue

                failures.append(f"{path}:{line_number}: Class C conformance rules must be removed or moved to their runtime owner")

            for line_number, line in enumerate(lines, start=1):
                match = CAM_CONFORMANCE_RULE_PROPERTY_RE.search(line)
                stripped = line.lstrip()
                if match is None or not stripped.startswith(("rule", "\"rule\"", "'rule'")):
                    continue

                expr = match.group("expr").strip()
                if self.conformance_rule_expression_is_descriptor_owned(expr):
                    continue

                failures.append(f"{path}:{line_number}: conformance issues must use typed rule descriptors")

            if "conformanceRule(" in text:
                failures.append(f"{path}: use keyed conformanceRules(...) maps so the rule code appears only once")

            for descriptor in CAM_CONFORMANCE_RULE_DESCRIPTOR_RE.finditer(text):
                rule = descriptor.group("rule")
                body = descriptor.group("body")
                validated_rules.add(rule)
                rule_class = self.required_ts_string_property(body, "class", path, rule, failures)
                reason = self.required_ts_string_property(body, "reason", path, rule, failures)
                if reason is not None and reason.strip() == "":
                    failures.append(f"{path}: {rule} descriptor must justify its conformance ownership")
                if rule_class == "B":
                    limitation = self.required_ts_string_property(body, "limitation", path, rule, failures)
                    if limitation is not None and limitation.strip() == "":
                        failures.append(f"{path}: {rule} Class B descriptor must document its limitation")

        for rule, locations in sorted(rule_locations.items()):
            if len(locations) > 1:
                failures.append(f"{rule} descriptor must have one owner:\n" + "\n".join(locations))
            if rule not in validated_rules:
                failures.append(f"{rule} descriptor was inventoried but not policy-validated:\n" + "\n".join(locations))

        if failures:
            self.fail("\n".join(failures))

    def test_shared_ts_fixtures_do_not_become_hidden_package_clients(self) -> None:
        allowed_source_imports = {
            "../../../js/packages/cam-protocol/src/json.ts",
            "../../../js/packages/cam-protocol/src/manifest.ts",
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
                # and resource-discovery primitives needed to discover
                # checked-in CAM resources; everything else should be a package
                # test or a real public package import.
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

    def tool_source_files(self) -> list[Path]:
        return sorted(repo_path("js/tools").glob("**/*.ts"))

    def shared_fixture_files(self) -> list[Path]:
        return sorted(repo_path("tests/fixtures").glob("**/*.mts"))

    def current_protocol_version_fixture_patterns(self) -> tuple[re.Pattern[str], re.Pattern[str]]:
        return (
            re.compile(rf"(?<![A-Za-z0-9_$])[\"']?cam[\"']?\s*:\s*[\"']{re.escape(protocol_document_version('CAM_VERSION'))}[\"']"),
            re.compile(rf"(?<![A-Za-z0-9_$])[\"']?ui[\"']?\s*:\s*[\"']{re.escape(protocol_document_version('UI_VERSION'))}[\"']"),
        )

    def relative_import_stays_in_source_root(self, importer: Path, specifier: str) -> bool:
        source_root = self.source_root(importer)
        target = (importer.parent / specifier).resolve()
        return target == source_root or source_root in target.parents

    def relative_import_resolves_to_protocol_facts(self, importer: Path, specifier: str) -> bool:
        if not specifier.startswith("."):
            return False

        target = (importer.parent / specifier).resolve()
        facts_root = repo_path("js/packages/cam-protocol/src/facts").resolve()
        return target == facts_root or facts_root in target.parents

    def imports_protocol_tool_entrypoint(self, specifier: str) -> bool:
        return specifier.endswith("packages/cam-protocol/dist/index.js")

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

    def import_statement_at_line(self, text: str, line_number: int) -> str:
        lines = text.splitlines()
        index = line_number - 1
        statement: list[str] = []
        while index < len(lines):
            statement.append(lines[index])
            if " from " in lines[index] or lines[index].strip().endswith('"') or lines[index].strip().endswith("'"):
                break
            index += 1
        return "\n".join(statement)

    def path_is_under(self, path: Path, root: Path) -> bool:
        return path == root or root in path.parents

    def imports_conformance_sourced_facet(self, specifier: str) -> bool:
        return "/sourced/" in specifier or specifier.startswith("../sourced/")

    def conformance_rule_expression_is_descriptor_owned(self, expression: str) -> bool:
        # The integrity facet is the only adapter from protocol error codes back
        # into conformance rule descriptors; all other issue sites should point
        # directly at a typed descriptor map.
        return expression.startswith(("RULES.", "RESOURCE_RULES.", "UI_CALL_RULES.", "resourceIntegrityRule("))

    def required_ts_string_property(
        self,
        text: str,
        name: str,
        path: Path,
        rule: str,
        failures: list[str],
    ) -> str | None:
        match = re.search(TS_STRING_PROPERTY_RE.format(name=re.escape(name)), text)
        if match is None:
            failures.append(f"{path}: {rule} descriptor must declare {name}")
            return None
        return match.group("value")

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
