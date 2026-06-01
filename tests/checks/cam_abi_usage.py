from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .cam_expressions import expression_first_segment, expression_references


@dataclass(frozen=True)
class AbiFunction:
    input_names: tuple[str | None, ...]
    state_mutability: str | None
    outputs: tuple[object, ...]


READ_ROUTE_MUTABILITY = frozenset({"view", "pure"})
WRITE_ACTION_MUTABILITY = frozenset({"nonpayable"})


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
                input_names=abi_input_names(inputs),
                state_mutability=state_mutability,
                outputs=abi_outputs,
            )
    return functions_by_name


def abi_input_names(inputs: list[object]) -> tuple[str | None, ...]:
    names: list[str | None] = []
    for item in inputs:
        if not isinstance(item, dict):
            names.append(None)
            continue

        name = item.get("name")
        if isinstance(name, str) and name != "":
            names.append(name)
        else:
            names.append(None)
    return tuple(names)


def validate_named_args(
    manifest_path: Path,
    location: str,
    contract_name: str,
    function_name: str,
    function: AbiFunction,
    args: dict[object, object],
) -> list[str]:
    # CAM route args are named, while ABI encoding is positional. Static checks
    # must therefore prove the names line up before runtime orders them.
    failures: list[str] = []
    input_names = function.input_names

    if any(name is None for name in input_names):
        failures.append(
            f"{manifest_path}: ABI inputs must be named for {contract_name}.{function_name} at {location}"
        )
        return failures

    expected_names = tuple(name for name in input_names if name is not None)
    expected = set(expected_names)
    actual = set(args)

    if len(expected) != len(expected_names):
        failures.append(
            f"{manifest_path}: ABI input names must be unique for {contract_name}.{function_name} at {location}"
        )
        return failures

    for name in sorted(expected - actual):
        failures.append(f"{manifest_path}: missing arg {name} for {contract_name}.{function_name} at {location}")

    for name in sorted(actual - expected):
        failures.append(f"{manifest_path}: unexpected arg {name} for {contract_name}.{function_name} at {location}")

    return failures


def validate_output_references(
    manifest_path: Path,
    location: str,
    output_count: int,
    value: object,
) -> list[str]:
    failures: list[str] = []

    for path, reference in expression_references(location, value, "outputs"):
        index = output_reference_index(reference)
        if index is None:
            failures.append(f"{manifest_path}: output expression must select a numbered output at {path}: {reference}")
            continue
        if index >= output_count:
            failures.append(
                f"{manifest_path}: output expression references output {index}, "
                f"but ABI declares {output_count} output(s) at {path}"
            )

    return failures


def tuple_component_names(parameter: object) -> tuple[str, ...] | None:
    if not isinstance(parameter, dict):
        return None
    if parameter.get("type") != "tuple":
        return None

    components = parameter.get("components")
    if not isinstance(components, list):
        return None

    names: list[str] = []
    for component in components:
        if not isinstance(component, dict):
            return None
        name = component.get("name")
        if not isinstance(name, str) or name == "":
            return None
        names.append(name)

    return tuple(names)


def output_reference_index(reference: str) -> int | None:
    segment = expression_first_segment(reference, "outputs")
    if segment is None:
        return None
    if segment == "0":
        return 0
    if segment.startswith("0") or not segment.isdecimal():
        return None

    return int(segment)


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


def validate_contract_action_function(
    manifest_path: Path,
    location: str,
    contract_name: str,
    function_name: str,
    function: AbiFunction,
) -> list[str]:
    failures: list[str] = []

    if function.state_mutability not in WRITE_ACTION_MUTABILITY:
        failures.append(
            f"{manifest_path}: write route must target a nonpayable ABI function "
            f"at {location}: {contract_name}.{function_name}"
        )

    return failures
