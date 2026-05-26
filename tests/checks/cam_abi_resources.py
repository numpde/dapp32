from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

from .common import read_text
from tools.cam_abi_plan import CamAbiPlanError, generated_abi_name


def validate_no_orphan_abi_files(
    manifest_path: Path,
    manifest: dict[str, object],
    *,
    existing_files: set[Path] | None = None,
) -> list[str]:
    contracts = manifest.get("contracts")
    if not isinstance(contracts, dict):
        return []

    referenced: set[Path] = set()
    for contract in contracts.values():
        if not isinstance(contract, dict):
            continue

        abi_uri = contract.get("abiURI")
        if not isinstance(abi_uri, str):
            continue

        abi_path = resolve_local_abi_path(manifest_path, abi_uri)
        if abi_path is not None:
            referenced.add(abi_path)

    if existing_files is None:
        abi_dir = manifest_path.parent / "abi"
        abi_files = set(abi_dir.glob("*.json")) if abi_dir.is_dir() else set()
    else:
        abi_files = existing_files

    failures: list[str] = []
    for orphan in sorted(abi_files - referenced):
        failures.append(
            f"{manifest_path}: cam/abi contains unused ABI file not referenced by contracts.*.abiURI: "
            f"{orphan.name}"
        )

    return failures


def validate_generated_abi_uri_convention(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
) -> str | None:
    try:
        generated_abi_name(manifest_path, contract_name, abi_uri)
    except CamAbiPlanError as error:
        return str(error)

    return None


def validate_local_abi_uri(
    manifest_path: Path,
    contract_name: str,
    abi_uri: object,
    *,
    existing_files: set[Path] | None = None,
    abi_documents: dict[Path, object] | None = None,
) -> str | None:
    path = f"contracts.{contract_name}.abiURI"
    if not isinstance(abi_uri, str) or abi_uri == "":
        return f"{manifest_path}: {path} must be a non-empty string"

    parsed = urlsplit(abi_uri)
    if parsed.scheme or parsed.netloc:
        return f"{manifest_path}: {path} must be a local relative URI: {abi_uri}"

    if abi_uri.startswith("/") or any(part in {"", ".", ".."} for part in Path(abi_uri).parts):
        return f"{manifest_path}: {path} must not be absolute or contain unsafe path segments: {abi_uri}"

    if not abi_uri.endswith(".json"):
        return f"{manifest_path}: {path} must target a JSON ABI file: {abi_uri}"

    resolved = resolve_local_abi_path(manifest_path, abi_uri)
    assert resolved is not None
    cam_dir = manifest_path.parent.resolve()
    if resolved != cam_dir and cam_dir not in resolved.parents:
        return f"{manifest_path}: {path} escapes the CAM directory: {abi_uri}"

    if existing_files is None:
        if not resolved.is_file():
            return f"{manifest_path}: {path} target does not exist: {abi_uri}"
    elif resolved not in existing_files:
        return f"{manifest_path}: {path} target does not exist: {abi_uri}"

    try:
        abi = abi_documents[resolved] if abi_documents is not None else json.loads(read_text(resolved))
    except json.JSONDecodeError as error:
        return f"{manifest_path}: {path} target is invalid JSON: {abi_uri}: {error}"

    if not isinstance(abi, list):
        return f"{manifest_path}: {path} target must be a JSON ABI array: {abi_uri}"

    return None


def resolve_local_abi_path(manifest_path: Path, abi_uri: str) -> Path | None:
    parsed = urlsplit(abi_uri)
    if parsed.scheme or parsed.netloc or abi_uri.startswith("/"):
        return None

    return (manifest_path.parent / abi_uri).resolve()
