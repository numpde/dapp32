"""Refresh manifest-pinned CAM resource digests.

`cam/main.json` is the contract-published root document. It pins secondary CAM
resources, such as ABI files and UI catalogs, with `sha256:0x...` integrity
fields. This tool recomputes those fields from local `./` resource references
so generated ABI updates and UI edits have one routine refresh path.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.json_policy import JsonPolicyError, read_strict_json  # noqa: E402


CONTRACT_NAMESPACE_PREFIX = "contracts."
INTEGRITY_PREFIX = "sha256:0x"
LOCAL_URI_PREFIX = "./"
UI_NAMESPACE = "ui"


class CamResourceIntegrityError(ValueError):
    pass


def refresh_dapps(dapps_root: Path) -> int:
    if dapps_root.is_symlink():
        raise CamResourceIntegrityError(f"refusing symlinked dapps root: {dapps_root}")
    if not dapps_root.is_dir():
        raise CamResourceIntegrityError(f"dapps root is not a directory: {dapps_root}")

    changed = 0
    manifests = sorted(dapps_root.glob("*/cam/main.json"))
    if not manifests:
        raise CamResourceIntegrityError(f"no CAM manifests found under {dapps_root}")

    for manifest_path in manifests:
        if refresh_manifest(manifest_path):
            changed += 1

    return changed


def refresh_manifest(manifest_path: Path) -> bool:
    if manifest_path.is_symlink():
        raise CamResourceIntegrityError(f"refusing symlinked CAM manifest: {manifest_path}")

    try:
        document = read_strict_json(manifest_path)
    except JsonPolicyError as error:
        raise CamResourceIntegrityError(f"{manifest_path}: invalid JSON: {error}") from error
    if not isinstance(document, dict):
        raise CamResourceIntegrityError(f"{manifest_path}: CAM manifest must be a JSON object")

    namespaces = document.get("namespaces")
    if not isinstance(namespaces, dict):
        raise CamResourceIntegrityError(f"{manifest_path}: namespaces must be an object")

    changed = False
    for namespace, declaration in namespaces.items():
        if not isinstance(namespace, str) or not isinstance(declaration, dict):
            continue

        if namespace.startswith(CONTRACT_NAMESPACE_PREFIX) and declaration.get("type") == "contract":
            changed |= refresh_integrity_field(
                manifest_path,
                declaration,
                "abiURI",
                "integrity",
                f"namespaces.{namespace}",
            )
        elif namespace == UI_NAMESPACE and declaration.get("type") == "ui":
            changed |= refresh_integrity_field(
                manifest_path,
                declaration,
                "uri",
                "integrity",
                "namespaces.ui",
            )

    if changed:
        write_json_in_place(manifest_path, document)

    return changed


def refresh_integrity_field(
    manifest_path: Path,
    declaration: dict[object, object],
    uri_key: str,
    integrity_key: str,
    path: str,
) -> bool:
    digest = resource_integrity(manifest_path, declaration.get(uri_key), f"{path}.{uri_key}")
    if declaration.get(integrity_key) == digest:
        return False

    declaration[integrity_key] = digest
    return True


def resource_integrity(manifest_path: Path, uri: object, path: str) -> str:
    if not isinstance(uri, str):
        raise CamResourceIntegrityError(f"{manifest_path}: {path} must be a string")
    if not uri.startswith(LOCAL_URI_PREFIX):
        raise CamResourceIntegrityError(f"{manifest_path}: {path} must be a local ./ resource")

    relative_path = Path(uri.removeprefix(LOCAL_URI_PREFIX))
    if relative_path.is_absolute() or ".." in relative_path.parts or str(relative_path) == "":
        raise CamResourceIntegrityError(f"{manifest_path}: {path} must stay under the CAM directory")

    resource_path = manifest_path.parent / relative_path
    if resource_path.is_symlink():
        raise CamResourceIntegrityError(f"{manifest_path}: refusing symlinked CAM resource: {uri}")
    if not resource_path.is_file():
        raise CamResourceIntegrityError(f"{manifest_path}: CAM resource does not exist: {uri}")

    digest = hashlib.sha256(resource_path.read_bytes()).hexdigest()
    return f"{INTEGRITY_PREFIX}{digest}"


def write_json_in_place(path: Path, document: dict[object, object]) -> None:
    # The Docker lane mounts only main.json read-write while the surrounding
    # repository stays read-only, so an atomic sibling-file replace is not
    # available there. Write the existing file directly and let checks verify it.
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        raise SystemExit("usage: cam_resource_integrity.py <dapps-root>")

    try:
        changed = refresh_dapps(Path(argv[1]))
    except CamResourceIntegrityError as error:
        raise SystemExit(f"cam-resource-integrity: {error}") from error

    print(f"cam-resource-integrity: refreshed {changed} manifest(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
