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
import re
import sys

CONTRACT_NAMESPACE_PREFIX = "contracts."
INTEGRITY_PREFIX = "sha256:0x"
INTEGRITY_PATTERN = re.compile(r"^sha256:0x[0-9a-f]{64}$")
LOCAL_URI_PREFIX = "./"
MAX_CAM_RESOURCE_BYTES = 2 * 1024 * 1024
UI_NAMESPACE = "ui"
ROUTES_NAMESPACE = "routes"


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
        from tools.json_policy import JsonPolicyError, read_strict_json

        document = read_strict_json(manifest_path)
    except JsonPolicyError as error:
        raise CamResourceIntegrityError(f"{manifest_path}: invalid JSON: {error}") from error
    if not isinstance(document, dict):
        raise CamResourceIntegrityError(f"{manifest_path}: CAM manifest must be a JSON object")

    namespaces = document.get("namespaces")
    if not isinstance(namespaces, dict):
        raise CamResourceIntegrityError(f"{manifest_path}: namespaces must be an object")

    changed = False
    for declaration, uri_key, integrity_key, path in resource_declarations(manifest_path, namespaces):
        changed |= refresh_integrity_field(
            manifest_path,
            declaration,
            uri_key,
            integrity_key,
            path,
        )

    if changed:
        write_json_in_place(manifest_path, document)

    return changed


def resource_declarations(
    manifest_path: Path,
    namespaces: dict[object, object],
) -> list[tuple[dict[object, object], str, str, str]]:
    resources: list[tuple[dict[object, object], str, str, str]] = []

    for namespace, declaration in namespaces.items():
        if not isinstance(namespace, str) or namespace == "":
            raise CamResourceIntegrityError(f"{manifest_path}: namespace names must be non-empty strings")
        if not isinstance(declaration, dict):
            raise CamResourceIntegrityError(f"{manifest_path}: namespaces.{namespace} must be an object")

        declaration_type = declaration.get("type")
        if not isinstance(declaration_type, str) or declaration_type == "":
            raise CamResourceIntegrityError(f"{manifest_path}: namespaces.{namespace}.type must be a non-empty string")

        if namespace.startswith(CONTRACT_NAMESPACE_PREFIX):
            if namespace == CONTRACT_NAMESPACE_PREFIX:
                raise CamResourceIntegrityError(f"{manifest_path}: contract namespace name must not be empty")
            if declaration_type != "contract":
                raise CamResourceIntegrityError(f"{manifest_path}: namespaces.{namespace}.type must be contract")
            resources.append((declaration, "abiURI", "integrity", f"namespaces.{namespace}"))
            continue

        if namespace == UI_NAMESPACE:
            if declaration_type != "ui":
                raise CamResourceIntegrityError(f"{manifest_path}: namespaces.ui.type must be ui")
            resources.append((declaration, "uri", "integrity", "namespaces.ui"))
            continue

        if namespace == ROUTES_NAMESPACE:
            if declaration_type != "routes":
                raise CamResourceIntegrityError(f"{manifest_path}: namespaces.routes.type must be routes")
            continue

        raise CamResourceIntegrityError(f"{manifest_path}: unsupported namespace: {namespace}")

    return resources


def refresh_integrity_field(
    manifest_path: Path,
    declaration: dict[object, object],
    uri_key: str,
    integrity_key: str,
    path: str,
) -> bool:
    current_digest = declaration.get(integrity_key)
    if not isinstance(current_digest, str) or not INTEGRITY_PATTERN.fullmatch(current_digest):
        raise CamResourceIntegrityError(
            f"{manifest_path}: {path}.{integrity_key} must be a sha256:0x-prefixed lowercase digest",
        )

    digest = resource_integrity(manifest_path, declaration.get(uri_key), f"{path}.{uri_key}")
    if current_digest == digest:
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

    unresolved_resource_path = manifest_path.parent / relative_path
    current_path = manifest_path.parent
    for part in relative_path.parts:
        current_path = current_path / part
        if current_path.is_symlink():
            raise CamResourceIntegrityError(f"{manifest_path}: refusing symlinked CAM resource path: {uri}")

    cam_dir = manifest_path.parent.resolve(strict=True)
    resource_path = unresolved_resource_path.resolve(strict=False)
    try:
        resource_path.relative_to(cam_dir)
    except ValueError as error:
        raise CamResourceIntegrityError(f"{manifest_path}: {path} must stay under the CAM directory") from error

    if resource_path.is_symlink():
        raise CamResourceIntegrityError(f"{manifest_path}: refusing symlinked CAM resource: {uri}")
    if not resource_path.is_file():
        raise CamResourceIntegrityError(f"{manifest_path}: CAM resource does not exist: {uri}")
    if resource_path.stat().st_size > MAX_CAM_RESOURCE_BYTES:
        raise CamResourceIntegrityError(
            f"{manifest_path}: CAM resource is too large: {uri} exceeds {MAX_CAM_RESOURCE_BYTES} bytes",
        )

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

    # Compose runs this script with Python isolated mode, so the repository root
    # is not importable by default. Keep that path mutation local to CLI use so
    # tests can import this module without changing global import resolution.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

    try:
        changed = refresh_dapps(Path(argv[1]))
    except CamResourceIntegrityError as error:
        raise SystemExit(f"cam-resource-integrity: {error}") from error

    print(f"cam-resource-integrity: refreshed {changed} manifest(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
