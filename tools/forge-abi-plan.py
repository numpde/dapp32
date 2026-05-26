from __future__ import annotations

import json
from pathlib import Path
import re
import sys


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ABI_URI = re.compile(r"^\./abi/([A-Za-z_][A-Za-z0-9_]*\.json)$")


def fail(message: str) -> None:
    raise SystemExit(f"forge-abi-plan: {message}")


def abi_plan_rows(root: Path) -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    seen_contracts: dict[str, str] = {}

    for dapp in sorted(root.iterdir(), key=lambda path: path.name):
        if dapp.is_symlink():
            fail(f"refusing symlinked dapp directory: {dapp}")
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
                fail(f"refusing symlinked ABI export input: {path}")
        if not abi_dir.is_dir():
            fail(f"{abi_dir} must exist before ABI export; do not let Docker create bind targets")

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            fail(f"{manifest_path} is not valid JSON: {error}")

        if not isinstance(manifest, dict):
            fail(f"{manifest_path} must contain a JSON object")

        contracts = manifest.get("contracts")
        if not isinstance(contracts, dict) or not contracts:
            fail(f"{manifest_path} must declare contracts.*.abiURI entries")

        for contract_name, contract in sorted(contracts.items()):
            if not isinstance(contract_name, str) or not IDENTIFIER.fullmatch(contract_name):
                fail(f"{manifest_path}: invalid contract name: {contract_name!r}")
            previous_dapp = seen_contracts.setdefault(contract_name, dapp.name)
            if previous_dapp != dapp.name:
                fail(
                    f"{manifest_path}: contract name {contract_name!r} is also declared by "
                    f"{previous_dapp}; ABI export requires globally unique CAM contract names"
                )
            if not isinstance(contract, dict):
                fail(f"{manifest_path}: contracts.{contract_name} must be an object")

            abi_uri = contract.get("abiURI")
            if not isinstance(abi_uri, str):
                fail(f"{manifest_path}: contracts.{contract_name}.abiURI must be a string")

            match = ABI_URI.fullmatch(abi_uri)
            if match is None:
                fail(
                    f"{manifest_path}: contracts.{contract_name}.abiURI must target "
                    f"./abi/{contract_name}.json"
                )

            abi_name = match.group(1)
            if abi_name != f"{contract_name}.json":
                fail(
                    f"{manifest_path}: contracts.{contract_name}.abiURI must be "
                    f"./abi/{contract_name}.json"
                )

            rows.append((dapp.name, contract_name, abi_name))

    if not rows:
        fail("no dapps with src/ and cam/main.json found")

    return rows


def write_plan(rows: list[tuple[str, str, str]], plan_path: Path) -> None:
    tmp_path = plan_path.with_suffix(".tmp")
    tmp_path.write_text(
        "".join("\t".join(row) + "\n" for row in rows),
        encoding="utf-8",
    )
    tmp_path.replace(plan_path)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        fail("usage: forge-abi-plan.py <dapps-root> <plan-path>")

    rows = abi_plan_rows(Path(argv[1]))
    write_plan(rows, Path(argv[2]))
    print(f"forge-abi-plan: wrote {len(rows)} manifest-declared ABI target(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
