from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AbiFunction:
    input_count: int
    state_mutability: str | None
    outputs: tuple[object, ...]


@dataclass(frozen=True)
class ContractActionReference:
    path: str
    contract_name: object
    function_name: object
    arg_count: int | None


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


def validate_contract_action_function(
    manifest_path: Path,
    location: str,
    action: ContractActionReference,
    function: AbiFunction,
) -> list[str]:
    failures: list[str] = []

    if function.state_mutability not in WRITE_ACTION_MUTABILITY:
        failures.append(
            f"{manifest_path}: write route must target a payable or nonpayable ABI function "
            f"at {location}: {action.contract_name}.{action.function_name}"
        )

    if action.arg_count is None:
        failures.append(f"{manifest_path}: write route args must be an object at {location}")
    elif action.arg_count != function.input_count:
        failures.append(
            f"{manifest_path}: write route has {action.arg_count} arg(s), "
            f"but {action.contract_name}.{action.function_name} expects {function.input_count} at {location}"
        )

    return failures
