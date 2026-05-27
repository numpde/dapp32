from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import cam_abi_resources as abi_resources
from . import cam_route_abi as route_abi
from .common import read_text, repo_path
from tools.json_policy import JsonPolicyError, strict_json_loads


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
            document = strict_json_loads(read_text(path))
        except JsonPolicyError as error:
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
            error = abi_resources.validate_local_abi_uri(manifest_path, contract_name, abi_uri)
            if error is not None:
                failures.append(error)

        return failures

    def validate_generated_abi_uri_conventions(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
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

            error = abi_resources.validate_generated_abi_uri_convention(
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
        failures: list[str] = []
        if not isinstance(contracts, dict):
            failures.append(f"{manifest_path}: contracts must be an object")
        if not isinstance(routes, dict):
            failures.append(f"{manifest_path}: routes must be an object")
        if failures:
            return failures

        abi_functions_by_contract, abi_failures = self.abi_route_functions_by_contract(manifest_path, contracts)
        failures.extend(abi_failures)

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
                failures.append(f"{manifest_path}: {path}.contract has no readable ABI function map: {contract_name}")
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
                route_abi.validate_route_function_mutability(
                    manifest_path,
                    path,
                    contract_name,
                    function_name,
                    function,
                )
            )
            failures.extend(
                route_abi.validate_route_output_shape(
                    manifest_path,
                    path,
                    contract_name,
                    function_name,
                    function,
                )
            )
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
        function: route_abi.AbiRouteFunction,
    ) -> list[str]:
        if not isinstance(route_name, str):
            return []

        screen_path = manifest_path.parent / "screens" / f"{route_name}.json"
        try:
            screen = self.read_json_object(screen_path)
        except AssertionError as error:
            return [str(error)]

        return route_abi.validate_screen_values_references(
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
    ) -> tuple[dict[str, dict[str, route_abi.AbiRouteFunction | None]], list[str]]:
        abi_functions_by_contract: dict[str, dict[str, route_abi.AbiRouteFunction | None]] = {}
        failures: list[str] = []
        for contract_name, contract in contracts.items():
            if not isinstance(contract_name, str) or contract_name == "":
                failures.append(f"{manifest_path}: contract names must be non-empty strings")
                continue

            if not isinstance(contract, dict):
                failures.append(f"{manifest_path}: contracts.{contract_name} must be an object")
                continue

            abi, error = abi_resources.load_local_abi_array(manifest_path, contract_name, contract.get("abiURI"))
            if error is not None:
                failures.append(error)
                continue

            assert abi is not None
            abi_functions_by_contract[contract_name] = route_abi.abi_route_functions(abi)

        return abi_functions_by_contract, failures

    def validate_no_orphan_abi_files(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        return abi_resources.validate_no_orphan_abi_files(manifest_path, manifest)
