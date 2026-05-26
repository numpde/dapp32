from __future__ import annotations

import json
import unittest
from pathlib import Path
from urllib.parse import urlsplit

from .common import read_text, repo_path


class CamManifestResourceTest(unittest.TestCase):
    def test_local_cam_contract_abi_uris_resolve_to_checked_in_abi_arrays(self) -> None:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            contracts = manifest.get("contracts")
            if not isinstance(contracts, dict):
                failures.append(f"{manifest_path}: contracts must be an object")
                continue

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

        if failures:
            self.fail("\n".join(failures))

    def test_cam_contract_abi_uris_follow_generated_resource_convention(self) -> None:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            contracts = manifest.get("contracts")
            if not isinstance(contracts, dict):
                continue

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

        if failures:
            self.fail("\n".join(failures))

    def test_cam_abi_directories_contain_only_manifest_referenced_files(self) -> None:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(self.validate_no_orphan_abi_files(manifest_path, manifest))

        if failures:
            self.fail("\n".join(failures))

    def test_cam_route_functions_exist_in_declared_abis(self) -> None:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(self.validate_route_functions_exist_in_abis(manifest_path, manifest))

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
            self.abi_function_inputs(
                [
                    {"type": "function", "name": "viewEntry", "inputs": [{"type": "address"}]},
                    {"type": "event", "name": "Ignored", "inputs": []},
                    {"type": "function", "name": "overloaded", "inputs": []},
                    {"type": "function", "name": "overloaded", "inputs": [{"type": "string"}]},
                ]
            ),
            {
                "viewEntry": 1,
                "overloaded": None,
            },
        )

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

    def read_json_object(self, path: Path) -> dict[str, object]:
        try:
            document = json.loads(read_text(path))
        except json.JSONDecodeError as error:
            raise AssertionError(f"{path}: invalid JSON: {error}") from error

        if not isinstance(document, dict):
            raise AssertionError(f"{path}: CAM manifest must be a JSON object")

        return document

    def validate_route_functions_exist_in_abis(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts = manifest.get("contracts")
        routes = manifest.get("routes")
        if not isinstance(contracts, dict) or not isinstance(routes, dict):
            return []

        abi_functions_by_contract: dict[str, dict[str, int | None]] = {}
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
                abi_functions_by_contract[contract_name] = self.abi_function_inputs(abi)

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

            if function_name not in functions:
                failures.append(
                    f"{manifest_path}: {path}.function is not present in {contract_name} ABI: {function_name}"
                )
                continue

            expected_arg_count = functions[function_name]
            if expected_arg_count is None:
                failures.append(
                    f"{manifest_path}: {path}.function is overloaded in {contract_name} ABI: {function_name}"
                )
                continue

            args = route.get("args")
            if not isinstance(args, list):
                failures.append(f"{manifest_path}: {path}.args must be an array")
                continue

            if len(args) != expected_arg_count:
                failures.append(
                    f"{manifest_path}: {path}.args has {len(args)} item(s), "
                    f"but {contract_name}.{function_name} expects {expected_arg_count}"
                )

        return failures

    def abi_function_inputs(self, abi: list[object]) -> dict[str, int | None]:
        inputs_by_name: dict[str, int | None] = {}
        for item in abi:
            if not isinstance(item, dict):
                continue
            if item.get("type") != "function":
                continue
            name = item.get("name")
            inputs = item.get("inputs")
            if isinstance(name, str) and isinstance(inputs, list):
                inputs_by_name[name] = None if name in inputs_by_name else len(inputs)
        return inputs_by_name

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
        path = f"contracts.{contract_name}.abiURI"
        if not isinstance(abi_uri, str):
            return f"{manifest_path}: {path} must be a string before generated ABI convention checks"

        resolved = self.resolve_local_abi_path(manifest_path, abi_uri)
        if resolved is None:
            return None

        cam_dir = manifest_path.parent.resolve()
        abi_dir = cam_dir / "abi"
        if resolved.parent != abi_dir:
            return f"{manifest_path}: {path} must target a file directly under cam/abi: {abi_uri}"

        if resolved.name != f"{contract_name}.json":
            return f"{manifest_path}: {path} basename must match the contract name: {abi_uri}"

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
