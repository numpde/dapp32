from __future__ import annotations

from pathlib import Path

from .common import read_text
from tools.json_policy import JsonPolicyError, strict_json_loads
from tools.cam_resource_integrity import CamResourceIntegrityError, local_resource_path


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


def load_local_abi_array(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> list[object]:
    resolved = checked_local_abi_path(manifest_path, contract_name, abi_uri)
    abi_error: JsonPolicyError | None = None
    try:
        abi = strict_json_loads(read_text(resolved))
    except JsonPolicyError as error:
        abi = None
        abi_error = error

    if abi_error is not None:
        raise CamAbiResourceError(
            f"{manifest_path}: {contract_abi_uri_path(contract_name)} target is invalid JSON: {abi_uri}: {abi_error}"
        )

    if not isinstance(abi, list):
        raise CamAbiResourceError(
            f"{manifest_path}: {contract_abi_uri_path(contract_name)} target must be a JSON ABI array: {abi_uri}"
        )

    return abi


def checked_local_abi_path(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> Path:
    path = contract_abi_uri_path(contract_name)
    if not isinstance(abi_uri, str):
        raise CamAbiResourceError(f"{manifest_path}: {path} must be a string")
    if not abi_uri.endswith(".json"):
        raise CamAbiResourceError(f"{manifest_path}: {path} must target a JSON ABI file: {abi_uri}")

    try:
        return local_resource_path(manifest_path, abi_uri, path)
    except CamResourceIntegrityError as error:
        raise CamAbiResourceError(str(error)) from error


def contract_abi_uri_path(contract_name: str) -> str:
    return f"namespaces.contracts.{contract_name}.abiURI"
