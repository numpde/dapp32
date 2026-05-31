from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import cam_abi_resources as abi_resources
from . import cam_abi_usage as abi_usage
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

    def validate_declared_abi_usage(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts = manifest.get("contracts")
        routes = manifest.get("routes")
        failures: list[str] = []
        if not isinstance(contracts, dict):
            failures.append(f"{manifest_path}: contracts must be an object")
        if not isinstance(routes, dict):
            failures.append(f"{manifest_path}: routes must be an object")
        if failures:
            return failures

        abi_functions_by_contract, abi_failures = self.abi_functions_by_contract(manifest_path, contracts)
        failures.extend(abi_failures)

        failures.extend(
            self.validate_route_functions_match_declared_abis(
                manifest_path,
                routes,
                abi_functions_by_contract,
            )
        )
        failures.extend(
            self.validate_screen_contract_actions_match_declared_abis(
                manifest_path,
                routes,
                abi_functions_by_contract,
            )
        )
        return failures

    def validate_route_functions_match_declared_abis(
        self,
        manifest_path: Path,
        routes: dict[object, object],
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]],
    ) -> list[str]:
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

            function, reference_failures = self.declared_abi_function(
                manifest_path,
                abi_functions_by_contract,
                path,
                contract_name,
                function_name,
                "route",
            )
            failures.extend(reference_failures)
            if function is None:
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
                abi_usage.validate_route_function_mutability(
                    manifest_path,
                    path,
                    contract_name,
                    function_name,
                    function,
                )
            )
            failures.extend(
                abi_usage.validate_route_output_shape(
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

    def validate_screen_contract_actions_match_declared_abis(
        self,
        manifest_path: Path,
        routes: dict[object, object],
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]],
    ) -> list[str]:
        failures: list[str] = []
        screen_paths: set[Path] = set()
        for route_name in routes:
            if isinstance(route_name, str):
                screen_paths.update(self.route_screen_paths(manifest_path, route_name))

        for screen_path in sorted(screen_paths):
            try:
                screen = self.read_json_object(screen_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            for action in abi_usage.contract_action_references(screen):
                location = f"{screen_path}:{action.path}" if action.path else str(screen_path)
                if not isinstance(action.contract_name, str) or action.contract_name == "":
                    failures.append(f"{manifest_path}: contract-call action must declare a contract at {location}")
                    continue
                if not isinstance(action.function_name, str) or action.function_name == "":
                    failures.append(f"{manifest_path}: contract-call action must declare a function at {location}")
                    continue

                function, reference_failures = self.declared_abi_function(
                    manifest_path,
                    abi_functions_by_contract,
                    location,
                    action.contract_name,
                    action.function_name,
                    "contract-call action",
                )
                failures.extend(reference_failures)
                if function is None:
                    continue

                failures.extend(
                    abi_usage.validate_contract_action_function(
                        manifest_path,
                        location,
                        action,
                        function,
                    )
                )

        return failures

    def declared_abi_function(
        self,
        manifest_path: Path,
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]],
        location: str,
        contract_name: str,
        function_name: str,
        purpose: str,
    ) -> tuple[abi_usage.AbiFunction | None, list[str]]:
        functions = abi_functions_by_contract.get(contract_name)
        if functions is None:
            return None, [f"{manifest_path}: {purpose} references undeclared contract at {location}: {contract_name}"]

        if function_name not in functions:
            return None, [
                f"{manifest_path}: {purpose} function is not present in {contract_name} ABI at {location}: "
                f"{function_name}"
            ]

        function = functions[function_name]
        if function is None:
            return None, [
                f"{manifest_path}: {purpose} function is overloaded in {contract_name} ABI at {location}: "
                f"{function_name}"
            ]

        return function, []

    def validate_route_screen_inventory(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        routes = manifest.get("routes")
        if not isinstance(routes, dict):
            return [f"{manifest_path}: routes must be an object"]

        failures: list[str] = []
        route_names: set[str] = set()
        for route_name in routes:
            if not isinstance(route_name, str) or route_name == "":
                failures.append(f"{manifest_path}: route names must be non-empty strings")
                continue

            route_names.add(route_name)

        screen_dir = manifest_path.parent / "screens"
        existing_screen_names = {path.name for path in screen_dir.glob("*.json")} if screen_dir.is_dir() else set()

        for route_name in sorted(route_names):
            if not self.route_screen_paths(manifest_path, route_name):
                failures.append(f"{manifest_path}: route has no matching CAM screen: screens/{route_name}[.*].json")

        for screen_name in sorted(existing_screen_names):
            matching_routes = self.matching_screen_routes(route_names, screen_name)
            if not matching_routes:
                failures.append(f"{manifest_path}: CAM screen has no matching route: screens/{screen_name}")
            elif len(matching_routes) > 1:
                failures.append(
                    f"{manifest_path}: CAM screen matches multiple routes: screens/{screen_name} -> "
                    f"{', '.join(matching_routes)}"
                )

        return failures

    def route_screen_paths(self, manifest_path: Path, route_name: str) -> list[Path]:
        screen_dir = manifest_path.parent / "screens"
        if not screen_dir.is_dir():
            return []

        return [
            path
            for path in sorted(screen_dir.glob("*.json"))
            if self.is_route_screen_name(route_name, path.name)
        ]

    def is_route_screen_name(self, route_name: str, screen_name: str) -> bool:
        if not screen_name.endswith(".json"):
            return False

        screen_stem = screen_name[:-len(".json")]
        if screen_stem == route_name:
            return True

        prefix = f"{route_name}."
        return screen_stem.startswith(prefix) and screen_stem != prefix

    def matching_screen_routes(self, route_names: set[str], screen_name: str) -> list[str]:
        return sorted(route_name for route_name in route_names if self.is_route_screen_name(route_name, screen_name))

    def validate_route_screen_values_references(
        self,
        manifest_path: Path,
        route_name: object,
        route_path: str,
        contract_name: str,
        function_name: str,
        function: abi_usage.AbiFunction,
    ) -> list[str]:
        if not isinstance(route_name, str):
            return []

        failures: list[str] = []
        screen_paths = self.route_screen_paths(manifest_path, route_name)
        if not screen_paths:
            return [f"{manifest_path}: {route_path} has no matching CAM screen: screens/{route_name}[.*].json"]

        for screen_path in screen_paths:
            try:
                screen = self.read_json_object(screen_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(
                abi_usage.validate_screen_values_references(
                    manifest_path,
                    route_path,
                    screen_path,
                    screen,
                    contract_name,
                    function_name,
                    function,
                )
            )

        return failures

    def abi_functions_by_contract(
        self,
        manifest_path: Path,
        contracts: dict[object, object],
    ) -> tuple[dict[str, dict[str, abi_usage.AbiFunction | None]], list[str]]:
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]] = {}
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
            abi_functions_by_contract[contract_name] = abi_usage.abi_functions(abi)

        return abi_functions_by_contract, failures

    def validate_no_orphan_abi_files(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        return abi_resources.validate_no_orphan_abi_files(manifest_path, manifest)
