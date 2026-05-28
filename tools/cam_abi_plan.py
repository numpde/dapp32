"""Build the checked-in ABI export plan from CAM manifests.

This module is the source of truth for mapping each dapp's `cam/main.json`
contract declarations to path-qualified Forge inspect targets. It deliberately
derives ABIs only from manifest-declared `./abi/<Contract>.json` entries and
requires matching `src/<Contract>.sol` files, so ABI export stays dapp-scoped
and does not rely on globally unique contract names.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re

from tools.json_policy import JsonPolicyError, read_strict_json


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
GENERATED_ABI_URI_RE = re.compile(r"^\./abi/([A-Za-z_][A-Za-z0-9_]*\.json)$")


class CamAbiPlanError(ValueError):
    pass


@dataclass(frozen=True)
class AbiPlanRow:
    dapp: str
    inspect_target: str
    abi_name: str

    def as_tsv(self) -> str:
        return f"{self.dapp}\t{self.inspect_target}\t{self.abi_name}\n"


def build_abi_plan_rows(root: Path) -> list[AbiPlanRow]:
    rows: list[AbiPlanRow] = []

    for dapp in sorted(root.iterdir(), key=lambda path: path.name):
        if dapp.is_symlink():
            raise CamAbiPlanError(f"refusing symlinked dapp directory: {dapp}")
        if not dapp.is_dir():
            continue

        src_dir = dapp / "src"
        cam_dir = dapp / "cam"
        manifest_path = cam_dir / "main.json"
        abi_dir = cam_dir / "abi"

        if not src_dir.is_dir() or not manifest_path.is_file():
            continue
        for path in (src_dir, cam_dir, manifest_path, abi_dir):
            if path.is_symlink():
                raise CamAbiPlanError(f"refusing symlinked ABI export input: {path}")
        if not abi_dir.is_dir():
            raise CamAbiPlanError(
                f"{abi_dir} must exist before ABI export; do not let Docker create bind targets"
            )

        try:
            manifest = read_strict_json(manifest_path)
        except JsonPolicyError as error:
            raise CamAbiPlanError(f"{manifest_path} is not valid JSON: {error}") from error

        if not isinstance(manifest, dict):
            raise CamAbiPlanError(f"{manifest_path} must contain a JSON object")

        contracts = manifest.get("contracts")
        if not isinstance(contracts, dict) or not contracts:
            raise CamAbiPlanError(f"{manifest_path} must declare contracts.*.abiURI entries")

        for contract_name, contract in sorted(contracts.items()):
            rows.append(abi_plan_row(manifest_path, dapp.name, dapp, contract_name, contract))

    if not rows:
        raise CamAbiPlanError("no dapps with src/ and cam/main.json found")

    return rows


def abi_plan_row(
    manifest_path: Path,
    dapp_name: str,
    dapp_path: Path,
    contract_name: object,
    contract: object,
) -> AbiPlanRow:
    if not isinstance(contract_name, str) or not IDENTIFIER_RE.fullmatch(contract_name):
        raise CamAbiPlanError(f"{manifest_path}: invalid contract name: {contract_name!r}")

    if not isinstance(contract, dict):
        raise CamAbiPlanError(f"{manifest_path}: contracts.{contract_name} must be an object")

    source_path = dapp_path / "src" / f"{contract_name}.sol"
    if source_path.is_symlink():
        raise CamAbiPlanError(f"{manifest_path}: refusing symlinked ABI export source: {source_path}")
    if not source_path.is_file():
        raise CamAbiPlanError(
            f"{manifest_path}: contracts.{contract_name} requires source file src/{contract_name}.sol "
            "for path-qualified ABI export"
        )

    abi_uri = contract.get("abiURI")
    abi_name = generated_abi_name(manifest_path, contract_name, abi_uri)
    return AbiPlanRow(
        dapp=dapp_name,
        inspect_target=f"{dapp_name}/src/{contract_name}.sol:{contract_name}",
        abi_name=abi_name,
    )


def generated_abi_name(manifest_path: Path, contract_name: str, abi_uri: object) -> str:
    if not isinstance(abi_uri, str):
        raise CamAbiPlanError(f"{manifest_path}: contracts.{contract_name}.abiURI must be a string")

    match = GENERATED_ABI_URI_RE.fullmatch(abi_uri)
    if match is None:
        raise CamAbiPlanError(
            f"{manifest_path}: contracts.{contract_name}.abiURI must target ./abi/{contract_name}.json"
        )

    abi_name = match.group(1)
    if abi_name != f"{contract_name}.json":
        raise CamAbiPlanError(
            f"{manifest_path}: contracts.{contract_name}.abiURI must be ./abi/{contract_name}.json"
        )

    return abi_name


def write_abi_plan(rows: list[AbiPlanRow], plan_path: Path) -> None:
    tmp_path = plan_path.with_suffix(".tmp")
    tmp_path.write_text("".join(row.as_tsv() for row in rows), encoding="utf-8")
    tmp_path.replace(plan_path)
