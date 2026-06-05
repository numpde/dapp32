from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import cam_abi_resources as abi_resources
from .common import read_text, repo_path
from tools.cam_resource_integrity import (
    CamResourceIntegrityError,
    CONTRACT_NAMESPACE_PREFIX,
    INTEGRITY_PATTERN,
    resource_declarations,
    resource_integrity,
)
from tools.json_policy import JsonPolicyError, strict_json_loads


class CamManifestResourceValidator:
    def cam_manifests(self) -> list[Path]:
        return sorted(repo_path("dapps").glob("*/cam/main.json"))

    def collect_manifest_failures(
        self,
        validate: Callable[[Path, dict[str, object]], list[str]],
    ) -> list[str]:
        failures: list[str] = []

        for manifest_path in self.cam_manifests():
            try:
                manifest = self.read_json_object(manifest_path)
            except AssertionError as error:
                failures.append(str(error))
                continue

            failures.extend(validate(manifest_path, manifest))

        return failures

    def read_json_object(self, path: Path) -> dict[str, object]:
        try:
            document = strict_json_loads(read_text(path))
        except JsonPolicyError as error:
            raise AssertionError(f"{path}: invalid JSON: {error}") from error

        if not isinstance(document, dict):
            raise AssertionError(f"{path}: JSON document must be an object")

        return document

    def validate_manifest_abi_uris(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        for contract_name, contract in contracts.items():
            failures.extend(
                abi_resources.validate_local_abi_uri(manifest_path, contract_name, contract.get("abiURI"))
            )

        return failures

    def validate_resource_inventory(self, manifest_path: Path, _manifest: dict[str, object]) -> list[str]:
        screen_dir = manifest_path.parent / "screens"
        if screen_dir.exists():
            return [f"{manifest_path}: namespaced CAM must not keep legacy screens/ resources"]

        return []

    def validate_resource_integrity(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        failures: list[str] = []
        resources, resource_failures = self.manifest_resource_declarations(manifest_path, manifest)
        failures.extend(resource_failures)
        for _namespace, declaration, uri_key, integrity_key, path in resources:
            failures.extend(
                self.validate_sha256_integrity(
                    manifest_path,
                    f"{path}.{integrity_key}",
                    declaration.get(uri_key),
                    declaration.get(integrity_key),
                )
            )

        return failures

    def validate_no_orphan_abi_files(self, manifest_path: Path, manifest: dict[str, object]) -> list[str]:
        contracts, failures = self.contract_namespaces(manifest_path, manifest)
        if failures:
            return failures

        return abi_resources.validate_no_orphan_abi_files(manifest_path, contracts)

    def contract_namespaces(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
    ) -> tuple[dict[str, dict[object, object]], list[str]]:
        resources, failures = self.manifest_resource_declarations(manifest_path, manifest)
        if failures:
            return {}, failures

        contracts = {
            namespace.removeprefix(CONTRACT_NAMESPACE_PREFIX): declaration
            for namespace, declaration, uri_key, _integrity_key, _path in resources
            if uri_key == "abiURI"
        }

        if not contracts:
            return {}, [f"{manifest_path}: no contract namespaces declared"]

        return contracts, []

    def manifest_resource_declarations(
        self,
        manifest_path: Path,
        manifest: dict[str, object],
    ) -> tuple[list[tuple[str, dict[object, object], str, str, str]], list[str]]:
        namespaces = manifest.get("namespaces")
        if not isinstance(namespaces, dict):
            return [], [f"{manifest_path}: namespaces must be an object"]

        resources: list[tuple[str, dict[object, object], str, str, str]] = []
        failures: list[str] = []
        try:
            resources = resource_declarations(manifest_path, namespaces)
        except CamResourceIntegrityError as error:
            failures.append(str(error))

        return resources, failures

    def validate_sha256_integrity(
        self,
        manifest_path: Path,
        field_path: str,
        uri: object,
        integrity: object,
    ) -> list[str]:
        if not isinstance(integrity, str) or not INTEGRITY_PATTERN.fullmatch(integrity):
            return [f"{manifest_path}: {field_path} must be a sha256:0x-prefixed lowercase digest"]

        actual: str | None = None
        failures: list[str] = []
        try:
            actual = resource_integrity(manifest_path, uri, field_path)
        except CamResourceIntegrityError as error:
            failures.append(str(error))

        if failures:
            return failures

        if actual != integrity:
            return [f"{manifest_path}: {field_path} does not match {uri}"]

        return []
