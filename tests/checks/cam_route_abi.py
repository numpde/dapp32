from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AbiRouteFunction:
    input_count: int
    state_mutability: str | None
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
    expected_abi_type: str | None


VALUES_EXPRESSION_RE = re.compile(
    r"^\$values\.(0|[1-9][0-9]*)(\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9][0-9]*))*$"
)
READ_ROUTE_MUTABILITY = frozenset({"view", "pure"})


def abi_route_functions(abi: list[object]) -> dict[str, AbiRouteFunction | None]:
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
                    state_mutability=item.get("stateMutability") if isinstance(item.get("stateMutability"), str) else None,
                    outputs=tuple(outputs) if isinstance(outputs, list) else (),
                )
            )
    return functions_by_name


def validate_route_function_mutability(
    manifest_path: Path,
    route_path: str,
    contract_name: str,
    function_name: str,
    function: AbiRouteFunction,
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


def validate_screen_values_references(
    manifest_path: Path,
    route_path: str,
    screen_path: Path,
    screen: object,
    contract_name: str,
    function_name: str,
    function: AbiRouteFunction,
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


def route_value_output(function: AbiRouteFunction, output_index: int) -> object | None:
    return function.value_outputs[output_index] if output_index < len(function.value_outputs) else None


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

    if isinstance(value, str):
        reference = values_reference(value, path, parent)
        return [] if reference is None else [reference]

    if isinstance(value, list):
        for index, item in enumerate(value):
            references.extend(values_references(item, join_json_path(path, str(index)), value))
        return references

    if isinstance(value, dict):
        for key, item in value.items():
            references.extend(values_references(item, join_json_path(path, str(key)), value))

    return references


def values_reference(value: str, path: str, parent: object | None) -> ValuesReference | None:
    match = VALUES_EXPRESSION_RE.match(value)
    if match is None:
        return None

    suffix = value.removeprefix(f"$values.{match.group(1)}")
    return ValuesReference(
        expression=value,
        path=path,
        output_index=int(match.group(1)),
        segments=() if suffix == "" else tuple(suffix.removeprefix(".").split(".")),
        expected_abi_type=expected_abi_type_for_screen_field(path, parent),
    )


def expected_abi_type_for_screen_field(path: str, parent: object | None) -> str | None:
    if not isinstance(parent, dict):
        return None

    if parent.get("type") == "address" and path.endswith(".address"):
        return "address"

    if parent.get("type") == "nft" and path.endswith(".contractAddress"):
        return "address"

    return None


def join_json_path(parent: str, key: str) -> str:
    return key if parent == "" else f"{parent}.{key}"
