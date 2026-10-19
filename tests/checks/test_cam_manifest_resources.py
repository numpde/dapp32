from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .common import protocol_document_version
from .cam_manifest_resources import CamManifestResourceValidator


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_manifests_match_declared_resource_inventory(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_resource_inventory),
            *self.validator.collect_manifest_failures(self.validator.validate_resource_integrity),
        ]

        if failures:
            self.fail("\n".join(failures))

    def test_resource_inventory_rejects_legacy_screens_directory(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            failures = self.validator.validate_resource_inventory(
                manifest_path,
                {},
            )

            (manifest_path.parent / "screens").mkdir()

            legacy_failures = self.validator.validate_resource_inventory(
                manifest_path,
                {},
            )

        self.assertEqual(
            failures,
            [],
        )
        self.assertEqual(
            legacy_failures,
            [f"{manifest_path}: namespaced CAM must not keep legacy screens/ resources"],
        )

    def test_contract_namespace_extraction_rejects_unsupported_namespaces(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            contracts, failures = self.validator.contract_namespaces(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": ZERO_SHA256,
                        },
                        "widgets": {
                            "type": "widgets",
                        },
                    },
                },
            )

        self.assertEqual(contracts, {})
        self.assertEqual(
            failures,
            [f"{manifest_path}: unsupported namespace: widgets"],
        )

    def test_resource_integrity_checks_sha256_digests(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            (abi_dir / "UI.json").write_text("[]\n", encoding="utf-8")
            (manifest_path.parent / "ui.json").write_text(
                json.dumps({"ui": protocol_document_version("UI_VERSION"), "nodes": {}}) + "\n",
                encoding="utf-8",
            )
            protocol_bytes = b"<p>CAM protocol fixture</p>"
            (manifest_path.parent / "protocol.html").write_bytes(protocol_bytes)

            failures = self.validator.validate_resource_integrity(
                manifest_path,
                {
                    "protocol": {
                        "uri": "./protocol.html",
                        "integrity": "sha256:0x" + hashlib.sha256(protocol_bytes).hexdigest(),
                    },
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": ZERO_SHA256,
                        },
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                            "integrity": ZERO_SHA256,
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: namespaces.contracts.UI.integrity does not match ./abi/UI.json",
                f"{manifest_path}: namespaces.ui.integrity does not match ./ui.json",
            ],
        )

    def test_resource_integrity_requires_protocol_object(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            for protocol in ("missing", None, "./protocol.html", [], 42):
                with self.subTest(protocol=protocol):
                    manifest = {"namespaces": {"routes": {"type": "routes"}}}
                    if protocol != "missing":
                        manifest["protocol"] = protocol
                    failures = self.validator.validate_resource_integrity(manifest_path, manifest)
                    self.assertEqual(
                        failures,
                        [f"{manifest_path}: protocol must be an object reference"],
                    )

ZERO_SHA256 = "sha256:0x0000000000000000000000000000000000000000000000000000000000000000"
