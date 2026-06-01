from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import cam_abi_resources as abi_resources
from . import cam_abi_usage as abi_usage
from .cam_expressions import expression_first_segment, expression_references
from .common import read_text, repo_path
from tools.cam_resource_integrity import (
    CamResourceIntegrityError,
    CONTRACT_NAMESPACE_PREFIX,
    INTEGRITY_PATTERN,
    ROUTES_NAMESPACE,
    UI_NAMESPACE,
    resource_declarations,
    resource_integrity,
)
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
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        for contract_name, contract in contracts.items():
            failures.extend(
                abi_resources.validate_local_abi_uri(manifest_path, contract_name, contract.get("abiURI"))
            )

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
        failures.extend(
            self.validate_ui_view_references_match_declared_abis(
                manifest_path,
                routes,
                abi_functions_by_contract,
            )
        )
        return failures

    def validate_resource_inventory(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        return self.validate_namespaced_ui_inventory(manifest_path, manifest)

    def validate_resource_integrity(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        failures: list[str] = []
        resources, resource_failures = self.manifest_resource_declarations(manifest_path, manifest)
        failures.extend(resource_failures)
        for _namespace, declaration, uri_key, integrity_key, path in resources:
            failures.extend(
                self.validate_sha256_integrity(
                    manifest_path,
                    f"{path}.{integrity_key}",
                    declaration.get(uri_key),
                    declaration.get(integrity_key),
                )
            )

        return failures

    def validate_declared_route_continuations(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        # Runtime route resolution is dynamic, but route continuations are still
        # declared names. Check those names here so manifest drift fails before
        # a viewer reaches a broken route or UI node.
        routes = manifest.get("routes")
        if not isinstance(routes, dict):
            return [f"{manifest_path}: routes must be an object"]

        ui_requires_by_node, ui_failures = self.ui_requires_by_node(manifest_path)
        failures = [*ui_failures]

        for route_name, route in routes.items():
            path = f"routes.{route_name}"
            if not isinstance(route_name, str) or route_name == "":
                failures.append(f"{manifest_path}: route names must be non-empty strings")
                continue
            if not isinstance(route, dict):
                failures.append(f"{manifest_path}: {path} must be an object")
                continue

            failures.extend(
                self.validate_route_continuation(
                    manifest_path,
                    routes,
                    ui_requires_by_node,
                    path,
                    route,
                )
            )

        return failures

    def validate_no_orphan_abi_files(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        return abi_resources.validate_no_orphan_abi_files(manifest_path, contracts)

    def contract_namespaces(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
    ) -> tuple[dict[str, dict[object, object]], list[str]]:
        resources, failures = self.manifest_resource_declarations(manifest_path, manifest)
        if failures:
            return {}, failures

        contracts = {
            namespace.removeprefix(CONTRACT_NAMESPACE_PREFIX): declaration
            for namespace, declaration, uri_key, _integrity_key, _path in resources
            if uri_key == "abiURI"
        }

        if not contracts:
            return {}, [f"{manifest_path}: no contract namespaces declared"]

        return contracts, []

    def manifest_resource_declarations(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
    ) -> tuple[list[tuple[str, dict[object, object], str, str, str]], list[str]]:
        namespaces = manifest.get("namespaces")
        if not isinstance(namespaces, dict):
            return [], [f"{manifest_path}: namespaces must be an object"]

        resources: list[tuple[str, dict[object, object], str, str, str]] = []
        failures: list[str] = []
        try:
            resources = resource_declarations(manifest_path, namespaces)
        except CamResourceIntegrityError as error:
            failures.append(str(error))

        return resources, failures

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
                abi_usage.validate_output_references(
                    manifest_path,
                    f"{path}.call.args",
                    0,
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
            then = route.get("then")
            if isinstance(then, dict):
                then_args = then.get("args")
                if isinstance(then_args, dict):
                    failures.extend(
                        abi_usage.validate_output_references(
                            manifest_path,
                            f"{path}.then.args",
                            len(function.outputs),
                            then_args,
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
        kind = route.get("kind")
        if kind == "read":
            return abi_usage.validate_route_function_mutability(
                manifest_path,
                f"{route_path}.call",
                contract_name,
                function_name,
                function,
            )

        if kind == "write":
            return abi_usage.validate_contract_action_function(
                manifest_path,
                f"{route_path}.call",
                contract_name,
                function_name,
                function,
            )

        return [f"{manifest_path}: {route_path}.kind must be read or write"]

    def validate_ui_view_references_match_declared_abis(
        self,
        manifest_path: Path,
        routes: dict[object, object],
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]],
    ) -> list[str]:
        # The contract chooses the concrete UI node at runtime, so this static
        # check only proves the shared view vocabulary: every top-level
        # `$view.foo` used by ui.json must exist on at least one read-route view
        # tuple returned by a declared contract ABI.
        fields, field_failures = self.contract_view_fields(manifest_path, routes, abi_functions_by_contract)
        references, reference_failures = self.ui_view_references(manifest_path)
        failures = [*field_failures, *reference_failures]
        if failures:
            return failures

        for path, field in references:
            if field not in fields:
                failures.append(f"{manifest_path}: UI expression references unknown contract view field at {path}: {field}")

        return failures

    def contract_view_fields(
        self,
        manifest_path: Path,
        routes: dict[object, object],
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]],
    ) -> tuple[set[str], list[str]]:
        fields: set[str] = set()
        failures: list[str] = []

        for route_name, route in routes.items():
            path = f"routes.{route_name}"
            if not isinstance(route_name, str) or not isinstance(route, dict) or route.get("kind") != "read":
                continue

            call = route.get("call")
            then = route.get("then")
            if not isinstance(call, dict) or not isinstance(then, dict):
                continue

            contract_name = self.contract_name_from_call_namespace(call.get("namespace"))
            function_name = call.get("function")
            if contract_name is None or not isinstance(function_name, str) or function_name == "":
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

            args = then.get("args")
            if not isinstance(args, dict):
                continue

            view_arg = args.get("view")
            if not isinstance(view_arg, str) or not view_arg.startswith("$outputs."):
                continue

            output_index = abi_usage.output_reference_index(view_arg)
            if output_index is None or output_index >= len(function.outputs):
                continue

            names = abi_usage.tuple_component_names(function.outputs[output_index])
            if names is None:
                failures.append(f"{manifest_path}: {path}.then.args.view must reference a tuple ABI output")
                continue

            fields.update(names)

        return fields, failures

    def ui_view_references(self, manifest_path: Path) -> tuple[list[tuple[str, str]], list[str]]:
        ui_path, ui, failures = self.read_ui_object(manifest_path)
        if failures:
            return [], failures
        assert ui is not None

        references: list[tuple[str, str]] = []
        for path, reference in expression_references(str(ui_path), ui, "view"):
            field = expression_first_segment(reference, "view")
            if field is not None:
                references.append((path, field))

        return references, []

    def validate_route_continuation(
        self,
        manifest_path: Path,
        routes: dict[object, object],
        ui_requires_by_node: dict[str, tuple[str, ...]],
        route_path: str,
        route: dict[object, object],
    ) -> list[str]:
        then = route.get("then")
        if not isinstance(then, dict):
            return [f"{manifest_path}: {route_path}.then must be an object"]

        namespace = then.get("namespace")
        kind = route.get("kind")
        function = then.get("function")
        args = then.get("args")
        continuation_path = f"{route_path}.then"
        if kind not in {"read", "write"}:
            return [f"{manifest_path}: {route_path}.kind must be read or write"]
        if not isinstance(function, str) or function == "":
            return [f"{manifest_path}: {continuation_path}.function must be a non-empty string"]
        if not isinstance(args, dict):
            return [f"{manifest_path}: {continuation_path}.args must be an object"]

        if namespace == ROUTES_NAMESPACE:
            if kind != "write":
                return [f"{manifest_path}: read route continuation must target ui at {continuation_path}"]
            target_route = routes.get(function)
            if not isinstance(target_route, dict):
                return [f"{manifest_path}: route continuation references unknown route at {continuation_path}: {function}"]

            target_inputs, input_failures = self.route_input_names(manifest_path, function, target_route)
            return [
                *input_failures,
                *self.validate_named_manifest_args(
                    manifest_path,
                    continuation_path,
                    f"route {function}",
                    target_inputs,
                    args,
                ),
            ]

        if namespace == UI_NAMESPACE:
            if kind != "read":
                return [f"{manifest_path}: write route continuation must target routes at {continuation_path}"]
            target_requires = ui_requires_by_node.get(function)
            if target_requires is None:
                return [f"{manifest_path}: route continuation references unknown UI node at {continuation_path}: {function}"]

            return self.validate_named_manifest_args(
                manifest_path,
                continuation_path,
                f"UI node {function}",
                target_requires,
                args,
            )

        return [f"{manifest_path}: {continuation_path}.namespace must be ui or routes"]

    def route_input_names(
        self,
        manifest_path: Path,
        route_name: str,
        route: dict[object, object],
    ) -> tuple[tuple[str, ...], list[str]]:
        inputs = route.get("inputs")
        if not isinstance(inputs, list):
            return (), [f"{manifest_path}: routes.{route_name}.inputs must be an array"]

        return self.string_list(manifest_path, f"routes.{route_name}.inputs", inputs)

    def ui_requires_by_node(self, manifest_path: Path) -> tuple[dict[str, tuple[str, ...]], list[str]]:
        ui_path, ui, failures = self.read_ui_object(manifest_path)
        if failures:
            return {}, failures
        assert ui is not None

        nodes = ui.get("nodes")
        if not isinstance(nodes, dict):
            return {}, [f"{ui_path}: nodes must be an object"]

        requires_by_node: dict[str, tuple[str, ...]] = {}
        for name, node in nodes.items():
            if not isinstance(node, dict):
                failures.append(f"{ui_path}: UI node must be an object: {name}")
                continue

            requires = node.get("requires")
            if not isinstance(requires, list):
                failures.append(f"{ui_path}: {name}.requires must be an array")
                continue

            required_names, require_failures = self.string_list(ui_path, f"{name}.requires", requires)
            failures.extend(require_failures)
            requires_by_node[name] = required_names

        return requires_by_node, failures

    def read_ui_object(self, manifest_path: Path) -> tuple[Path, dict[str, object] | None, list[str]]:
        ui_path = manifest_path.parent / "ui.json"
        failures: list[str] = []
        ui: dict[str, object] | None = None

        if not ui_path.is_file():
            failures.append(f"{manifest_path}: namespaces.ui.uri target does not exist: ./ui.json")
            return ui_path, ui, failures

        try:
            ui = self.read_json_object(ui_path)
        except AssertionError as error:
            failures.append(str(error))

        return ui_path, ui, failures

    def string_list(
        self,
        path: Path,
        field_path: str,
        value: list[object],
    ) -> tuple[tuple[str, ...], list[str]]:
        failures: list[str] = []
        names: list[str] = []
        seen: set[str] = set()
        for index, item in enumerate(value):
            item_path = f"{field_path}.{index}"
            if not isinstance(item, str) or item == "":
                failures.append(f"{path}: {item_path} must be a non-empty string")
                continue
            if item in seen:
                failures.append(f"{path}: duplicate name in {field_path}: {item}")
                continue

            seen.add(item)
            names.append(item)

        return tuple(names), failures

    def validate_named_manifest_args(
        self,
        manifest_path: Path,
        location: str,
        target_name: str,
        expected_names: tuple[str, ...],
        args: dict[object, object],
    ) -> list[str]:
        expected = set(expected_names)
        actual = set(args)
        failures: list[str] = []

        for name in sorted(expected - actual):
            failures.append(f"{manifest_path}: missing continuation arg {name} for {target_name} at {location}")

        for name in sorted(actual - expected):
            failures.append(f"{manifest_path}: unexpected continuation arg {name} for {target_name} at {location}")

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

    def contract_name_from_call_namespace(self, namespace: object) -> str | None:
        if not isinstance(namespace, str) or not namespace.startswith(CONTRACT_NAMESPACE_PREFIX):
            return None

        contract_name = namespace.removeprefix(CONTRACT_NAMESPACE_PREFIX)
        if contract_name == "":
            return None

        return contract_name

    def validate_namespaced_ui_inventory(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        resources, failures = self.manifest_resource_declarations(manifest_path, manifest)
        if failures:
            return failures

        ui_declarations = [
            declaration
            for namespace, declaration, _uri_key, _integrity_key, _path in resources
            if namespace == UI_NAMESPACE
        ]
        if not ui_declarations:
            return [f"{manifest_path}: namespaces.ui must be an object"]

        uri = ui_declarations[0].get("uri")
        if uri != "./ui.json":
            failures.append(f"{manifest_path}: namespaces.ui.uri must be ./ui.json")
        elif not (manifest_path.parent / "ui.json").is_file():
            failures.append(f"{manifest_path}: namespaces.ui.uri target does not exist: ./ui.json")

        screen_dir = manifest_path.parent / "screens"
        if screen_dir.exists():
            failures.append(f"{manifest_path}: namespaced CAM must not keep legacy screens/ resources")

        return failures

    def validate_sha256_integrity(
        self,
        manifest_path: Path,
        field_path: str,
        uri: object,
        integrity: object,
    ) -> list[str]:
        if not isinstance(integrity, str) or not INTEGRITY_PATTERN.fullmatch(integrity):
            return [f"{manifest_path}: {field_path} must be a sha256:0x-prefixed lowercase digest"]

        actual: str | None = None
        failures: list[str] = []
        try:
            actual = resource_integrity(manifest_path, uri, field_path)
        except CamResourceIntegrityError as error:
            failures.append(str(error))

        if failures:
            return failures

        if actual != integrity:
            return [f"{manifest_path}: {field_path} does not match {uri}"]

        return []

    def abi_functions_by_contract(
        self,
        manifest_path: Path,
        contracts: dict[str, dict[object, object]],
    ) -> tuple[dict[str, dict[str, abi_usage.AbiFunction | None]], list[str]]:
        abi_functions_by_contract: dict[str, dict[str, abi_usage.AbiFunction | None]] = {}
        failures: list[str] = []
        for contract_name, contract in contracts.items():
            try:
                abi = abi_resources.load_local_abi_array(manifest_path, contract_name, contract.get("abiURI"))
            except abi_resources.CamAbiResourceError as error:
                failures.append(str(error))
                continue

            abi_functions_by_contract[contract_name] = abi_usage.abi_functions(abi)

        return abi_functions_by_contract, failures
