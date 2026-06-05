from __future__ import annotations

from pathlib import Path

from tools.cam_resource_integrity import CamResourceIntegrityError, local_resource_path
from tools.cam_abi_plan import CamAbiPlanError, generated_abi_name


class CamAbiResourceError(ValueError):
    pass


def validate_no_orphan_abi_files(
    manifest_path: Path,
    contracts: dict[str, dict[object, object]],
) -> list[str]:
    referenced: set[Path] = set()
    failures: list[str] = []
    for contract_name, contract in contracts.items():
        try:
            abi_path = checked_local_abi_path(manifest_path, contract_name, contract.get("abiURI"))
        except CamAbiResourceError as error:
            failures.append(str(error))
            continue

        referenced.add(abi_path)

    abi_dir = manifest_path.parent / "abi"
    abi_files = set(abi_dir.glob("*.json")) if abi_dir.is_dir() else set()

    for orphan in sorted(abi_files - referenced):
        failures.append(
            f"{manifest_path}: cam/abi contains unused ABI file not referenced by namespaces.contracts.*.abiURI: "
            f"{orphan.name}"
        )

    return failures


def validate_local_abi_uri(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> list[str]:
    failures: list[str] = []
    try:
        checked_local_abi_path(manifest_path, contract_name, abi_uri)
    except CamAbiResourceError as error:
        failures.append(str(error))

    return failures


def checked_local_abi_path(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> Path:
    path = contract_abi_uri_path(contract_name)
    try:
        abi_name = generated_abi_name(manifest_path, contract_name, abi_uri)
    except CamAbiPlanError as error:
        raise CamAbiResourceError(str(error)) from error

    try:
        return local_resource_path(manifest_path, f"./abi/{abi_name}", path)
    except CamResourceIntegrityError as error:
        raise CamAbiResourceError(str(error)) from error


def contract_abi_uri_path(contract_name: str) -> str:
    return f"namespaces.contracts.{contract_name}.abiURI"
