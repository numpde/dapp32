from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AbiFunction:
    input_count: int
    state_mutability: str | None
    outputs: tuple[object, ...]

    @property
    def first_output(self) -> object | None:
        if not self.outputs:
            return None
        return self.outputs[0]

    @property
    def value_outputs(self) -> tuple[object, ...]:
        return self.outputs[1:]


@dataclass(frozen=True)
class ValuesReference:
    expression: str
    path: str
    output_index: int
    segments: tuple[str, ...]
    expected_abi_type: str | None


@dataclass(frozen=True)
class ContractActionReference:
    path: str
    contract_name: object
    function_name: object
    arg_count: int | None


VALUES_EXPRESSION_RE = re.compile(
    r"^\$values\.(0|[1-9][0-9]*)(\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9][0-9]*))*$"
)
READ_ROUTE_MUTABILITY = frozenset({"view", "pure"})
WRITE_ACTION_MUTABILITY = frozenset({"nonpayable", "payable"})


def abi_functions(abi: list[object]) -> dict[str, AbiFunction | None]:
    functions_by_name: dict[str, AbiFunction | None] = {}
    for item in abi:
        if not isinstance(item, dict):
            continue
        if item.get("type") != "function":
            continue
        name = item.get("name")
        inputs = item.get("inputs")
        if isinstance(name, str) and isinstance(inputs, list):
            outputs = item.get("outputs")
            if name in functions_by_name:
                functions_by_name[name] = None
                continue

            state_mutability = item.get("stateMutability")
            if not isinstance(state_mutability, str):
                state_mutability = None

            abi_outputs: tuple[object, ...] = ()
            if isinstance(outputs, list):
                abi_outputs = tuple(outputs)

            functions_by_name[name] = AbiFunction(
                input_count=len(inputs),
                state_mutability=state_mutability,
                outputs=abi_outputs,
            )
    return functions_by_name


def validate_route_function_mutability(
    manifest_path: Path,
    route_path: str,
    contract_name: str,
    function_name: str,
    function: AbiFunction,
) -> list[str]:
    if function.state_mutability in READ_ROUTE_MUTABILITY:
        return []

    return [
        f"{manifest_path}: {route_path}.function must be view or pure in {contract_name} ABI: "
        f"{function_name}"
    ]


def validate_route_output_shape(
    manifest_path: Path,
    route_path: str,
    contract_name: str,
    function_name: str,
    function: AbiFunction,
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


def validate_contract_action_function(
    manifest_path: Path,
    location: str,
    action: ContractActionReference,
    function: AbiFunction,
) -> list[str]:
    failures: list[str] = []

    if function.state_mutability not in WRITE_ACTION_MUTABILITY:
        failures.append(
            f"{manifest_path}: contract-call action must target a payable or nonpayable ABI function "
            f"at {location}: {action.contract_name}.{action.function_name}"
        )

    if action.arg_count is None:
        failures.append(f"{manifest_path}: contract-call action args must be an array at {location}")
    elif action.arg_count != function.input_count:
        failures.append(
            f"{manifest_path}: contract-call action has {action.arg_count} arg(s), "
            f"but {action.contract_name}.{action.function_name} expects {function.input_count} at {location}"
        )

    return failures


def validate_screen_values_references(
    manifest_path: Path,
    route_path: str,
    screen_path: Path,
    screen: object,
    contract_name: str,
    function_name: str,
    function: AbiFunction,
) -> list[str]:
    failures: list[str] = []
    for reference in values_references(screen):
        location = f"{screen_path}:{reference.path}" if reference.path else str(screen_path)
        output = route_value_output(function, reference.output_index)
        if output is None:
            failures.append(
                f"{manifest_path}: {route_path} screen references missing route value output "
                f"$values.{reference.output_index} at {location}: {reference.expression}"
            )
            continue

        output_path, path_error = resolve_abi_output_path(output, reference.segments)
        if path_error is not None:
            failures.append(
                f"{manifest_path}: {route_path} screen references {path_error} in "
                f"{contract_name}.{function_name} output at {location}: {reference.expression}"
            )
            continue

        error = validate_expected_abi_type(output_path, reference.expected_abi_type)
        if error is not None:
            failures.append(
                f"{manifest_path}: {route_path} screen references {error} in "
                f"{contract_name}.{function_name} output at {location}: {reference.expression}"
            )

    return failures


def contract_action_references(value: object, path: str = "") -> list[ContractActionReference]:
    references: list[ContractActionReference] = []

    for action_path, item, _parent in walk_json(value, path):
        if isinstance(item, dict) and item.get("type") == "contract-call":
            args = item.get("args")
            arg_count = None
            if isinstance(args, list):
                arg_count = len(args)
            references.append(
                ContractActionReference(
                    path=action_path,
                    contract_name=item.get("contract"),
                    function_name=item.get("function"),
                    arg_count=arg_count,
                )
            )

    return references


def route_value_output(function: AbiFunction, output_index: int) -> object | None:
    if output_index >= len(function.value_outputs):
        return None
    return function.value_outputs[output_index]


def resolve_abi_output_path(output: object, segments: tuple[str, ...]) -> tuple[object | None, str | None]:
    current = output
    for segment in segments:
        if not isinstance(current, dict):
            return None, f"non-object ABI output segment: {segment}"

        output_type = current.get("type")
        components = current.get("components")
        if output_type != "tuple" or not isinstance(components, list):
            return None, f"field on non-tuple ABI output: {segment}"

        next_output = abi_component_by_name(components, segment)
        if next_output is None:
            return None, f"unknown ABI output field: {segment}"

        current = next_output

    return current, None


def validate_expected_abi_type(output: object, expected_type: str | None) -> str | None:
    if expected_type is None:
        return None

    if not isinstance(output, dict):
        return f"non-object ABI output where {expected_type} is required"

    output_type = output.get("type")
    if output_type == expected_type:
        return None

    return f"ABI output type {output_type!r} where {expected_type!r} is required"


def abi_component_by_name(components: list[object], name: str) -> object | None:
    for component in components:
        if isinstance(component, dict) and component.get("name") == name:
            return component

    return None


def values_references(value: object, path: str = "", parent: object | None = None) -> list[ValuesReference]:
    references: list[ValuesReference] = []

    for item_path, item, item_parent in walk_json(value, path, parent):
        if isinstance(item, str):
            reference = values_reference(item, item_path, item_parent)
            if reference is not None:
                references.append(reference)

    return references


def walk_json(value: object, path: str = "", parent: object | None = None) -> Iterator[tuple[str, object, object | None]]:
    yield path, value, parent

    if isinstance(value, list):
        for index, item in enumerate(value):
            yield from walk_json(item, join_json_path(path, str(index)), value)

    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk_json(item, join_json_path(path, str(key)), value)


def values_reference(value: str, path: str, parent: object | None) -> ValuesReference | None:
    match = VALUES_EXPRESSION_RE.match(value)
    if match is None:
        return None

    suffix = value.removeprefix(f"$values.{match.group(1)}")
    return ValuesReference(
        expression=value,
        path=path,
        output_index=int(match.group(1)),
        segments=value_reference_segments(suffix),
        expected_abi_type=expected_abi_type_for_screen_field(path, parent),
    )


def value_reference_segments(suffix: str) -> tuple[str, ...]:
    if suffix == "":
        return ()
    return tuple(suffix.removeprefix(".").split("."))


def expected_abi_type_for_screen_field(path: str, parent: object | None) -> str | None:
    if not isinstance(parent, dict):
        return None

    if parent.get("type") == "address" and path.endswith(".address"):
        return "address"

    if parent.get("type") == "input" and path.endswith(".value"):
        return "string"

    if parent.get("type") == "nft" and path.endswith(".contractAddress"):
        return "address"

    return None


def join_json_path(parent: str, key: str) -> str:
    return key if parent == "" else f"{parent}.{key}"
