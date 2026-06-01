from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import cam_abi_resources as abi_resources
from . import cam_abi_usage as abi_usage
from .common import read_text, repo_path
from tools.json_policy import JsonPolicyError, strict_json_loads


CONTRACT_NAMESPACE_PREFIX = "contracts."


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
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        for contract_name, contract in contracts.items():
            error = abi_resources.validate_local_abi_uri(manifest_path, contract_name, contract.get("abiURI"))
            if error is not None:
                failures.append(error)

        return failures

    def validate_declared_abi_usage(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        routes = manifest.get("routes")
        if not isinstance(routes, dict):
            failures.append(f"{manifest_path}: routes must be an object")
        if failures:
            return failures

        abi_functions_by_contract, abi_failures = self.abi_functions_by_contract(manifest_path, contracts)
        failures.extend(abi_failures)
        failures.extend(
            self.validate_route_calls_match_declared_abis(
                manifest_path,
                routes,
                abi_functions_by_contract,
            )
        )
        return failures

    def validate_resource_inventory(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        return self.validate_namespaced_ui_inventory(manifest_path, manifest)

    def validate_no_orphan_abi_files(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        return abi_resources.validate_no_orphan_abi_files(manifest_path, {"contracts": contracts})

    def contract_namespaces(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
    ) -> tuple[dict[str, dict[object, object]], list[str]]:
        namespaces = manifest.get("namespaces")
        if not isinstance(namespaces, dict):
            return {}, [f"{manifest_path}: namespaces must be an object"]

        failures: list[str] = []
        contracts: dict[str, dict[object, object]] = {}

        for namespace, declaration in namespaces.items():
            if not isinstance(namespace, str) or not namespace.startswith(CONTRACT_NAMESPACE_PREFIX):
                continue

            contract_name = namespace.removeprefix(CONTRACT_NAMESPACE_PREFIX)
            if contract_name == "":
                failures.append(f"{manifest_path}: contract namespace names must be non-empty")
                continue
            if contract_name in contracts:
                failures.append(f"{manifest_path}: duplicate contract namespace: {namespace}")
                continue
            if not isinstance(declaration, dict):
                failures.append(f"{manifest_path}: namespaces.{namespace} must be an object")
                continue
            if declaration.get("type") != "contract":
                failures.append(f"{manifest_path}: namespaces.{namespace}.type must be contract")
                continue

            contracts[contract_name] = declaration

        if not contracts:
            failures.append(f"{manifest_path}: no contract namespaces declared")

        return contracts, failures

    def validate_route_calls_match_declared_abis(
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

            call = route.get("call")
            if not isinstance(call, dict):
                failures.append(f"{manifest_path}: {path}.call must be an object")
                continue

            contract_name = self.contract_name_from_call_namespace(call.get("namespace"))
            function_name = call.get("function")
            if contract_name is None or not isinstance(function_name, str) or function_name == "":
                failures.append(f"{manifest_path}: {path}.call must declare contract namespace and function")
                continue

            function, reference_failures = self.declared_abi_function(
                manifest_path,
                abi_functions_by_contract,
                f"{path}.call",
                contract_name,
                function_name,
                "route call",
            )
            failures.extend(reference_failures)
            if function is None:
                continue

            args = call.get("args")
            if not isinstance(args, dict):
                failures.append(f"{manifest_path}: {path}.call.args must be an object")
                continue
            failures.extend(
                abi_usage.validate_named_args(
                    manifest_path,
                    f"{path}.call",
                    contract_name,
                    function_name,
                    function,
                    args,
                )
            )

            failures.extend(
                self.validate_route_call_mutability(
                    manifest_path,
                    path,
                    route,
                    contract_name,
                    function_name,
                    function,
                )
            )

        return failures

    def validate_route_call_mutability(
        self,
        manifest_path: Path,
        route_path: str,
        route: dict[object, object],
        contract_name: str,
        function_name: str,
        function: abi_usage.AbiFunction,
    ) -> list[str]:
        then = route.get("then")
        if not isinstance(then, dict):
            return [f"{manifest_path}: {route_path}.then must be an object"]

        then_namespace = then.get("namespace")
        if then_namespace == "ui":
            return abi_usage.validate_route_function_mutability(
                manifest_path,
                f"{route_path}.call",
                contract_name,
                function_name,
                function,
            )

        if then_namespace == "routes":
            return abi_usage.validate_contract_action_function(
                manifest_path,
                f"{route_path}.call",
                contract_name,
                function_name,
                function,
            )

        return [f"{manifest_path}: {route_path}.then.namespace must be ui or routes"]

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

    def contract_name_from_call_namespace(self, namespace: object) -> str | None:
        if not isinstance(namespace, str) or not namespace.startswith(CONTRACT_NAMESPACE_PREFIX):
            return None

        contract_name = namespace.removeprefix(CONTRACT_NAMESPACE_PREFIX)
        if contract_name == "":
            return None

        return contract_name

    def validate_namespaced_ui_inventory(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        namespaces = manifest.get("namespaces")
        if not isinstance(namespaces, dict):
            return [f"{manifest_path}: namespaces must be an object"]

        ui = namespaces.get("ui")
        if not isinstance(ui, dict):
            return [f"{manifest_path}: namespaces.ui must be an object"]

        failures: list[str] = []
        if ui.get("type") != "ui":
            failures.append(f"{manifest_path}: namespaces.ui.type must be ui")

        uri = ui.get("uri")
        if uri != "./ui.json":
            failures.append(f"{manifest_path}: namespaces.ui.uri must be ./ui.json")
        elif not (manifest_path.parent / "ui.json").is_file():
            failures.append(f"{manifest_path}: namespaces.ui.uri target does not exist: ./ui.json")

        screen_dir = manifest_path.parent / "screens"
        if screen_dir.exists():
            failures.append(f"{manifest_path}: namespaced CAM must not keep legacy screens/ resources")

        return failures

    def abi_functions_by_contract(
        self,
        manifest_path: Path,
        contracts: dict[str, dict[object, object]],
    ) -> tuple[dict[str, dict[str, abi_usage.AbiFunction | None]], list[str]]:
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]] = {}
        failures: list[str] = []
        for contract_name, contract in contracts.items():
            abi, error = abi_resources.load_local_abi_array(manifest_path, contract_name, contract.get("abiURI"))
            if error is not None:
                failures.append(error)
                continue

            assert abi is not None
            abi_functions_by_contract[contract_name] = abi_usage.abi_functions(abi)

        return abi_functions_by_contract, failures
