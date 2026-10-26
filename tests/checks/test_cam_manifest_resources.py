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

    def test_cam_manifest_resource_integrity_matches_declared_resources(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_resource_integrity)

        if failures:
            self.fail("\n".join(failures))

    def test_published_read_routes_share_one_stable_application_frame(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_application_frame)
        self.assertEqual(failures, [])

    def test_application_frame_is_one_owner_not_matching_captions(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "main.json"
            ui_path = manifest_path.parent / "views.json"
            frame = {"element": "Screen", "props": {"title": "Fixture app"}, "children": [
                {"element": "Include", "call": {"namespace": "ui", "function": "$screen", "args": {}}}
            ]}
            document = {"nodes": {"first": frame, "second": frame}}
            ui_path.write_text(json.dumps(document), encoding="utf-8")
            manifest = {"namespaces": {"ui": {"type": "ui", "uri": "./views.json"}}, "routes": {
                "entry": {"kind": "read", "then": {"namespace": "ui", "function": "first"}},
                "task": {"kind": "read", "then": {"namespace": "ui", "function": "first"}},
            }}
            self.assertEqual(self.validator.validate_application_frame(manifest_path, manifest), [])
            manifest["routes"]["task"]["then"]["function"] = "second"
            self.assertTrue(self.validator.validate_application_frame(manifest_path, manifest))
            manifest["routes"]["task"]["then"]["function"] = "first"
            for title in ("", "  ", "$view.title"):
                with self.subTest(title=title):
                    frame["props"]["title"] = title
                    ui_path.write_text(json.dumps(document), encoding="utf-8")
                    self.assertTrue(self.validator.validate_application_frame(manifest_path, manifest))
            frame["props"]["title"] = "Fixture app"
            frame["element"] = "Include"
            ui_path.write_text(json.dumps(document), encoding="utf-8")
            self.assertTrue(self.validator.validate_application_frame(manifest_path, manifest))

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
            screens_dir = manifest_path.parent / "screens"
            abi_dir.mkdir(parents=True)
            screens_dir.mkdir()
            (abi_dir / "UI.json").write_text("[]\n", encoding="utf-8")
            (screens_dir / "ui.json").write_text(
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
                            "uri": "./screens/ui.json",
                            "integrity": ZERO_SHA256,
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: namespaces.contracts.UI.integrity does not match ./abi/UI.json",
                f"{manifest_path}: namespaces.ui.integrity does not match ./screens/ui.json",
            ],
        )

    def test_missing_resource_returns_its_primary_integrity_failure(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            failures = self.validator.validate_sha256_integrity(
                manifest_path,
                "namespaces.ui.integrity",
                "./screens/missing.json",
                ZERO_SHA256,
            )

        self.assertEqual(
            failures,
            [f"{manifest_path}: CAM resource does not exist: ./screens/missing.json"],
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
