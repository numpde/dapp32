from __future__ import annotations

import json
import re
import unittest
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from .common import read_text, repo_path
from tools.cam_abi_plan import CamAbiPlanError, generated_abi_name


@dataclass(frozen=True)
class AbiRouteFunction:
    input_count: int
    outputs: tuple[object, ...]

    @property
    def first_output(self) -> object | None:
        return self.outputs[0] if self.outputs else None

    @property
    def value_outputs(self) -> tuple[object, ...]:
        return self.outputs[1:]


@dataclass(frozen=True)
class ValuesReference:
    expression: str
    path: str
    output_index: int
    segments: tuple[str, ...]


VALUES_EXPRESSION_RE = re.compile(
    r"^\$values\.(0|[1-9][0-9]*)(\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9][0-9]*))*$"
)


class CamManifestResourceTest(unittest.TestCase):
    def test_local_cam_contract_abi_uris_resolve_to_checked_in_abi_arrays(self) -> None:
        failures = self.collect_manifest_failures(self.validate_manifest_abi_uris)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_contract_abi_uris_follow_generated_resource_convention(self) -> None:
        failures = self.collect_manifest_failures(self.validate_generated_abi_uri_conventions)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_abi_directories_contain_only_manifest_referenced_files(self) -> None:
        failures = self.collect_manifest_failures(self.validate_no_orphan_abi_files)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_route_functions_match_declared_abis(self) -> None:
        failures = self.collect_manifest_failures(self.validate_route_functions_match_declared_abis)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_manifest_resource_checker_self_check(self) -> None:
        manifest = repo_path("dapps/example/cam/main.json")

        self.assertIsNone(
            self.validate_local_abi_uri(
                manifest,
                "Example",
                "./abi/Example.json",
                existing_files={repo_path("dapps/example/cam/abi/Example.json")},
                abi_documents={repo_path("dapps/example/cam/abi/Example.json"): []},
            )
        )

        rejected = [
            ("Missing", None),
            ("Absolute", "/tmp/Example.json"),
            ("Remote", "https://example.test/Example.json"),
            ("Escape", "../abi/Example.json"),
            ("WrongSuffix", "./abi/Example.txt"),
            ("MissingFile", "./abi/Missing.json"),
        ]
        for contract_name, abi_uri in rejected:
            with self.subTest(contract_name=contract_name):
                self.assertIsNotNone(
                    self.validate_local_abi_uri(
                        manifest,
                        contract_name,
                        abi_uri,
                        existing_files={repo_path("dapps/example/cam/abi/Example.json")},
                        abi_documents={repo_path("dapps/example/cam/abi/Example.json"): []},
                    )
                )

        self.assertIsNone(
            self.validate_local_abi_uri(
                manifest,
                "Example",
                "./custom/Example.json",
                existing_files={repo_path("dapps/example/cam/custom/Example.json")},
                abi_documents={repo_path("dapps/example/cam/custom/Example.json"): []},
            )
        )

        convention_rejected = [
            ("WrongDirectory", "Example", "./custom/Example.json"),
            ("WrongBasename", "Example", "./abi/Other.json"),
        ]
        for case_name, contract_name, abi_uri in convention_rejected:
            with self.subTest(case_name=case_name):
                self.assertIsNotNone(
                    self.validate_generated_abi_uri_convention(manifest, contract_name, abi_uri)
                )

        self.assertIsNotNone(
            self.validate_local_abi_uri(
                manifest,
                "ObjectAbi",
                "./abi/ObjectAbi.json",
                existing_files={repo_path("dapps/example/cam/abi/ObjectAbi.json")},
                abi_documents={repo_path("dapps/example/cam/abi/ObjectAbi.json"): {}},
            )
        )

        self.assertEqual(
            self.abi_route_functions(
                [
                    {"type": "function", "name": "viewEntry", "inputs": [{"type": "address"}]},
                    {"type": "event", "name": "Ignored", "inputs": []},
                    {"type": "function", "name": "overloaded", "inputs": []},
                    {"type": "function", "name": "overloaded", "inputs": [{"type": "string"}]},
                ]
            ),
            {
                "viewEntry": AbiRouteFunction(input_count=1, outputs=()),
                "overloaded": None,
            },
        )

        self.assertEqual(
            self.validate_route_output_shape(
                manifest,
                "routes.entry",
                "Example",
                "viewEntry",
                AbiRouteFunction(
                    input_count=1,
                    outputs=({"name": "screenURI", "type": "string"},),
                ),
            ),
            [],
        )

        bad_first_outputs = [
            ("MissingOutputs", None),
            ("WrongName", {"name": "uri", "type": "string"}),
            ("WrongType", {"name": "screenURI", "type": "bytes32"}),
            ("MalformedOutput", "screenURI"),
        ]
        for case_name, first_output in bad_first_outputs:
            with self.subTest(case_name=case_name):
                self.assertTrue(
                    self.validate_route_output_shape(
                        manifest,
                        "routes.entry",
                        "Example",
                        "viewEntry",
                        AbiRouteFunction(input_count=1, outputs=() if first_output is None else (first_output,)),
                    )
                )

        route_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.exists"},
                {"type": "status", "value": "$values.1"},
            ],
        }
        route_function = AbiRouteFunction(
            input_count=0,
            outputs=(
                {"name": "screenURI", "type": "string"},
                {
                    "name": "component",
                    "type": "tuple",
                    "components": [{"name": "exists", "type": "bool"}],
                },
                {"name": "count", "type": "uint256"},
            ),
        )
        self.assertEqual(
            self.validate_screen_values_references(
                manifest,
                "routes.entry",
                manifest.parent / "screens" / "entry.json",
                route_screen,
                "Example",
                "viewEntry",
                route_function,
            ),
            [],
        )

        bad_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.missing"},
                {"type": "status", "value": "$values.1.count"},
                {"type": "status", "value": "$values.2"},
            ],
        }
        failures = self.validate_screen_values_references(
            manifest,
            "routes.entry",
            manifest.parent / "screens" / "entry.json",
            bad_screen,
            "Example",
            "viewEntry",
            route_function,
        )
        self.assertEqual(len(failures), 3)

        self.assertEqual(
            self.validate_no_orphan_abi_files(
                manifest,
                {
                    "contracts": {
                        "Example": {
                            "abiURI": "./abi/Example.json",
                        }
                    }
                },
                existing_files={
                    repo_path("dapps/example/cam/abi/Example.json"),
                    repo_path("dapps/example/cam/abi/Unused.json"),
                },
            ),
            [f"{manifest}: cam/abi contains unused ABI file not referenced by contracts.*.abiURI: Unused.json"],
        )

    def cam_manifests(self) -> list[Path]:
        return sorted(repo_path("dapps").glob("*/cam/main.json"))

    def collect_manifest_failures(
        self,
        validate: Callable[[Path, dict[str, object]], list[str]],
    ) -> list[str]:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(validate(manifest_path, manifest))

        return failures

    def read_json_object(self, path: Path) -> dict[str, object]:
        try:
            document = json.loads(read_text(path))
        except json.JSONDecodeError as error:
            raise AssertionError(f"{path}: invalid JSON: {error}") from error

        if not isinstance(document, dict):
            raise AssertionError(f"{path}: JSON document must be an object")

        return document

    def validate_manifest_abi_uris(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts = manifest.get("contracts")
        if not isinstance(contracts, dict):
            return [f"{manifest_path}: contracts must be an object"]

        failures: list[str] = []
        for contract_name, contract in contracts.items():
            if not isinstance(contract_name, str) or contract_name == "":
                failures.append(f"{manifest_path}: contract names must be non-empty strings")
                continue

            if not isinstance(contract, dict):
                failures.append(f"{manifest_path}: contracts.{contract_name} must be an object")
                continue

            abi_uri = contract.get("abiURI")
            error = self.validate_local_abi_uri(manifest_path, contract_name, abi_uri)
            if error is not None:
                failures.append(error)

        return failures

    def validate_generated_abi_uri_conventions(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts = manifest.get("contracts")
        if not isinstance(contracts, dict):
            return []

        failures: list[str] = []
        for contract_name, contract in contracts.items():
            if not isinstance(contract_name, str) or not isinstance(contract, dict):
                continue

            error = self.validate_generated_abi_uri_convention(
                manifest_path,
                contract_name,
                contract.get("abiURI"),
            )
            if error is not None:
                failures.append(error)

        return failures

    def validate_route_functions_match_declared_abis(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts = manifest.get("contracts")
        routes = manifest.get("routes")
        if not isinstance(contracts, dict) or not isinstance(routes, dict):
            return []

        abi_functions_by_contract = self.abi_route_functions_by_contract(manifest_path, contracts)

        failures: list[str] = []
        for route_name, route in routes.items():
            path = f"routes.{route_name}"
            if not isinstance(route_name, str) or route_name == "":
                failures.append(f"{manifest_path}: route names must be non-empty strings")
                continue

            if not isinstance(route, dict):
                failures.append(f"{manifest_path}: {path} must be an object")
                continue

            contract_name = route.get("contract")
            function_name = route.get("function")
            if not isinstance(contract_name, str) or not isinstance(function_name, str):
                failures.append(f"{manifest_path}: {path} must declare string contract and function fields")
                continue

            functions = abi_functions_by_contract.get(contract_name)
            if functions is None:
                continue

            function = functions.get(function_name)
            if function_name not in functions:
                failures.append(
                    f"{manifest_path}: {path}.function is not present in {contract_name} ABI: {function_name}"
                )
                continue

            if function is None:
                failures.append(
                    f"{manifest_path}: {path}.function is overloaded in {contract_name} ABI: {function_name}"
                )
                continue

            args = route.get("args")
            if not isinstance(args, list):
                failures.append(f"{manifest_path}: {path}.args must be an array")
                continue

            if len(args) != function.input_count:
                failures.append(
                    f"{manifest_path}: {path}.args has {len(args)} item(s), "
                    f"but {contract_name}.{function_name} expects {function.input_count}"
                )

            failures.extend(self.validate_route_output_shape(manifest_path, path, contract_name, function_name, function))
            failures.extend(
                self.validate_route_screen_values_references(
                    manifest_path,
                    route_name,
                    path,
                    contract_name,
                    function_name,
                    function,
                )
            )

        return failures

    def validate_route_screen_values_references(
        self,
        manifest_path: Path,
        route_name: object,
        route_path: str,
        contract_name: str,
        function_name: str,
        function: AbiRouteFunction,
    ) -> list[str]:
        if not isinstance(route_name, str):
            return []

        screen_path = manifest_path.parent / "screens" / f"{route_name}.json"
        try:
            screen = self.read_json_object(screen_path)
        except AssertionError as error:
            return [str(error)]

        return self.validate_screen_values_references(
            manifest_path,
            route_path,
            screen_path,
            screen,
            contract_name,
            function_name,
            function,
        )

    def validate_screen_values_references(
        self,
        manifest_path: Path,
        route_path: str,
        screen_path: Path,
        screen: object,
        contract_name: str,
        function_name: str,
        function: AbiRouteFunction,
    ) -> list[str]:
        failures: list[str] = []
        for reference in self.values_references(screen):
            location = f"{screen_path}:{reference.path}" if reference.path else str(screen_path)
            output = self.route_value_output(function, reference.output_index)
            if output is None:
                failures.append(
                    f"{manifest_path}: {route_path} screen references missing route value output "
                    f"$values.{reference.output_index} at {location}: {reference.expression}"
                )
                continue

            error = self.validate_abi_output_path(output, reference.segments)
            if error is not None:
                failures.append(
                    f"{manifest_path}: {route_path} screen references {error} in "
                    f"{contract_name}.{function_name} output at {location}: {reference.expression}"
                )

        return failures

    def route_value_output(self, function: AbiRouteFunction, output_index: int) -> object | None:
        return function.value_outputs[output_index] if output_index < len(function.value_outputs) else None

    def validate_abi_output_path(self, output: object, segments: tuple[str, ...]) -> str | None:
        current = output
        for segment in segments:
            if not isinstance(current, dict):
                return f"non-object ABI output segment: {segment}"

            output_type = current.get("type")
            components = current.get("components")
            if output_type != "tuple" or not isinstance(components, list):
                return f"field on non-tuple ABI output: {segment}"

            next_output = self.abi_component_by_name(components, segment)
            if next_output is None:
                return f"unknown ABI output field: {segment}"

            current = next_output

        return None

    def abi_component_by_name(self, components: list[object], name: str) -> object | None:
        for component in components:
            if isinstance(component, dict) and component.get("name") == name:
                return component

        return None

    def values_references(self, value: object, path: str = "") -> list[ValuesReference]:
        references: list[ValuesReference] = []

        if isinstance(value, str):
            reference = self.values_reference(value, path)
            return [] if reference is None else [reference]

        if isinstance(value, list):
            for index, item in enumerate(value):
                references.extend(self.values_references(item, self.join_json_path(path, str(index))))
            return references

        if isinstance(value, dict):
            for key, item in value.items():
                references.extend(self.values_references(item, self.join_json_path(path, str(key))))

        return references

    def values_reference(self, value: str, path: str) -> ValuesReference | None:
        match = VALUES_EXPRESSION_RE.match(value)
        if match is None:
            return None

        suffix = value.removeprefix(f"$values.{match.group(1)}")
        return ValuesReference(
            expression=value,
            path=path,
            output_index=int(match.group(1)),
            segments=() if suffix == "" else tuple(suffix.removeprefix(".").split(".")),
        )

    def join_json_path(self, parent: str, key: str) -> str:
        return key if parent == "" else f"{parent}.{key}"

    def validate_route_output_shape(
        self,
        manifest_path: Path,
        route_path: str,
        contract_name: str,
        function_name: str,
        function: AbiRouteFunction,
    ) -> list[str]:
        first_output = function.first_output
        if first_output is None:
            return [
                f"{manifest_path}: {route_path}.function must return screenURI as its first output: "
                f"{contract_name}.{function_name}"
            ]

        if not isinstance(first_output, dict):
            return [
                f"{manifest_path}: {route_path}.function first output must be an ABI object: "
                f"{contract_name}.{function_name}"
            ]

        failures: list[str] = []
        if first_output.get("name") != "screenURI":
            failures.append(
                f"{manifest_path}: {route_path}.function first output must be named screenURI: "
                f"{contract_name}.{function_name}"
            )

        if first_output.get("type") != "string":
            failures.append(
                f"{manifest_path}: {route_path}.function first output must have ABI type string: "
                f"{contract_name}.{function_name}"
            )

        return failures

    def abi_route_functions_by_contract(
        self,
        manifest_path: Path,
        contracts: dict[object, object],
    ) -> dict[str, dict[str, AbiRouteFunction | None]]:
        abi_functions_by_contract: dict[str, dict[str, AbiRouteFunction | None]] = {}
        for contract_name, contract in contracts.items():
            if not isinstance(contract_name, str) or not isinstance(contract, dict):
                continue

            abi_uri = contract.get("abiURI")
            if not isinstance(abi_uri, str):
                continue

            abi_path = self.resolve_local_abi_path(manifest_path, abi_uri)
            if abi_path is None or not abi_path.is_file():
                continue

            try:
                abi = json.loads(read_text(abi_path))
            except json.JSONDecodeError:
                continue

            if isinstance(abi, list):
                abi_functions_by_contract[contract_name] = self.abi_route_functions(abi)

        return abi_functions_by_contract

    def abi_route_functions(self, abi: list[object]) -> dict[str, AbiRouteFunction | None]:
        functions_by_name: dict[str, AbiRouteFunction | None] = {}
        for item in abi:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "function":
                continue
            name = item.get("name")
            inputs = item.get("inputs")
            if isinstance(name, str) and isinstance(inputs, list):
                outputs = item.get("outputs")
                functions_by_name[name] = (
                    None
                    if name in functions_by_name
                    else AbiRouteFunction(
                        input_count=len(inputs),
                        outputs=tuple(outputs) if isinstance(outputs, list) else (),
                    )
                )
        return functions_by_name

    def validate_no_orphan_abi_files(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
        *,
        existing_files: set[Path] | None = None,
    ) -> list[str]:
        contracts = manifest.get("contracts")
        if not isinstance(contracts, dict):
            return []

        referenced: set[Path] = set()
        for contract in contracts.values():
            if not isinstance(contract, dict):
                continue

            abi_uri = contract.get("abiURI")
            if not isinstance(abi_uri, str):
                continue

            abi_path = self.resolve_local_abi_path(manifest_path, abi_uri)
            if abi_path is not None:
                referenced.add(abi_path)

        if existing_files is None:
            abi_dir = manifest_path.parent / "abi"
            abi_files = set(abi_dir.glob("*.json")) if abi_dir.is_dir() else set()
        else:
            abi_files = existing_files

        failures: list[str] = []
        for orphan in sorted(abi_files - referenced):
            failures.append(
                f"{manifest_path}: cam/abi contains unused ABI file not referenced by contracts.*.abiURI: "
                f"{orphan.name}"
            )

        return failures

    def validate_generated_abi_uri_convention(
        self,
        manifest_path: Path,
        contract_name: str,
        abi_uri: object,
    ) -> str | None:
        try:
            generated_abi_name(manifest_path, contract_name, abi_uri)
        except CamAbiPlanError as error:
            return str(error)

        return None

    def validate_local_abi_uri(
        self,
        manifest_path: Path,
        contract_name: str,
        abi_uri: object,
        *,
        existing_files: set[Path] | None = None,
        abi_documents: dict[Path, object] | None = None,
    ) -> str | None:
        path = f"contracts.{contract_name}.abiURI"
        if not isinstance(abi_uri, str) or abi_uri == "":
            return f"{manifest_path}: {path} must be a non-empty string"

        parsed = urlsplit(abi_uri)
        if parsed.scheme or parsed.netloc:
            return f"{manifest_path}: {path} must be a local relative URI: {abi_uri}"

        if abi_uri.startswith("/") or any(part in {"", ".", ".."} for part in Path(abi_uri).parts):
            return f"{manifest_path}: {path} must not be absolute or contain unsafe path segments: {abi_uri}"

        if not abi_uri.endswith(".json"):
            return f"{manifest_path}: {path} must target a JSON ABI file: {abi_uri}"

        resolved = self.resolve_local_abi_path(manifest_path, abi_uri)
        assert resolved is not None
        cam_dir = manifest_path.parent.resolve()
        if resolved != cam_dir and cam_dir not in resolved.parents:
            return f"{manifest_path}: {path} escapes the CAM directory: {abi_uri}"

        if existing_files is None:
            if not resolved.is_file():
                return f"{manifest_path}: {path} target does not exist: {abi_uri}"
        elif resolved not in existing_files:
            return f"{manifest_path}: {path} target does not exist: {abi_uri}"

        try:
            abi = abi_documents[resolved] if abi_documents is not None else json.loads(read_text(resolved))
        except json.JSONDecodeError as error:
            return f"{manifest_path}: {path} target is invalid JSON: {abi_uri}: {error}"

        if not isinstance(abi, list):
            return f"{manifest_path}: {path} target must be a JSON ABI array: {abi_uri}"

        return None

    def resolve_local_abi_path(self, manifest_path: Path, abi_uri: str) -> Path | None:
        parsed = urlsplit(abi_uri)
        if parsed.scheme or parsed.netloc or abi_uri.startswith("/"):
            return None

        return (manifest_path.parent / abi_uri).resolve()
