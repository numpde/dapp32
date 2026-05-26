from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from urllib.parse import urlsplit

from .cam_route_abi import AbiRouteFunction, abi_route_functions
from .cam_route_abi import validate_route_function_mutability as validate_abi_route_function_mutability
from .cam_route_abi import validate_route_output_shape as validate_abi_route_output_shape
from .cam_route_abi import validate_screen_values_references as validate_abi_screen_values_references
from .cam_screen_schema import CamScreenSchemaValidator
from .common import read_text, repo_path
from tools.cam_abi_plan import CamAbiPlanError, generated_abi_name


SCREEN_SCHEMA_VALIDATOR = CamScreenSchemaValidator()


class CamManifestResourceValidator:
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

            failures.extend(
                validate_abi_route_function_mutability(manifest_path, path, contract_name, function_name, function)
            )
            failures.extend(validate_abi_route_output_shape(manifest_path, path, contract_name, function_name, function))
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

    def validate_manifest_screens(self, manifest_path: Path, _manifest: dict[str, object]) -> list[str]:
        failures: list[str] = []
        screen_dir = manifest_path.parent / "screens"
        for screen_path in sorted(screen_dir.glob("*.json")) if screen_dir.is_dir() else ():
            try:
                screen = self.read_json_object(screen_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(SCREEN_SCHEMA_VALIDATOR.validate_screen_document(screen_path, screen))

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

        return validate_abi_screen_values_references(
            manifest_path,
            route_path,
            screen_path,
            screen,
            contract_name,
            function_name,
            function,
        )

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
                abi_functions_by_contract[contract_name] = abi_route_functions(abi)

        return abi_functions_by_contract

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
