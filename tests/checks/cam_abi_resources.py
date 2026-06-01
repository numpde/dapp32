from __future__ import annotations

from pathlib import Path

from .common import read_text
from tools.json_policy import JsonPolicyError, strict_json_loads
from tools.cam_resource_integrity import CamResourceIntegrityError, local_resource_path


def validate_no_orphan_abi_files(
    manifest_path: Path,
    contracts: dict[str, dict[object, object]],
) -> list[str]:
    referenced: set[Path] = set()
    failures: list[str] = []
    for contract_name, contract in contracts.items():
        abi_path, error = checked_local_abi_path(
            manifest_path,
            contract_name,
            contract.get("abiURI"),
        )
        if error is not None:
            failures.append(error)
            continue

        assert abi_path is not None
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
) -> str | None:
    _abi, error = load_local_abi_array(
        manifest_path,
        contract_name,
        abi_uri,
    )
    return error


def load_local_abi_array(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> tuple[list[object] | None, str | None]:
    resolved, error = checked_local_abi_path(
        manifest_path,
        contract_name,
        abi_uri,
    )
    if error is not None:
        return None, error

    assert resolved is not None
    abi_error: JsonPolicyError | None = None
    try:
        abi = strict_json_loads(read_text(resolved))
    except JsonPolicyError as error:
        abi = None
        abi_error = error

    if abi_error is not None:
        return None, f"{manifest_path}: {contract_abi_uri_path(contract_name)} target is invalid JSON: {abi_uri}: {abi_error}"

    if not isinstance(abi, list):
        return None, f"{manifest_path}: {contract_abi_uri_path(contract_name)} target must be a JSON ABI array: {abi_uri}"

    return abi, None


def checked_local_abi_path(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> tuple[Path | None, str | None]:
    path = contract_abi_uri_path(contract_name)
    if not isinstance(abi_uri, str):
        return None, f"{manifest_path}: {path} must be a string"
    if not abi_uri.endswith(".json"):
        return None, f"{manifest_path}: {path} must target a JSON ABI file: {abi_uri}"

    resolved: Path | None = None
    failures: list[str] = []
    try:
        resolved = local_resource_path(manifest_path, abi_uri, path)
    except CamResourceIntegrityError as error:
        failures.append(str(error))
    if failures:
        return None, failures[0]

    assert resolved is not None
    return resolved, None


def contract_abi_uri_path(contract_name: str) -> str:
    return f"namespaces.contracts.{contract_name}.abiURI"
