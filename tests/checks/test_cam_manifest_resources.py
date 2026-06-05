from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
from tools.cam_abi_plan import build_abi_plan_rows


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

    def test_namespaced_ui_inventory_rejects_missing_ui_or_legacy_screens(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            failures = self.validator.validate_resource_inventory(
                manifest_path,
                {
                    "namespaces": {
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                        },
                    }
                },
            )

            (manifest_path.parent / "ui.json").write_text("{}\n", encoding="utf-8")
            (manifest_path.parent / "screens").mkdir()

            legacy_failures = self.validator.validate_resource_inventory(
                manifest_path,
                {
                    "namespaces": {
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                        },
                    }
                },
            )

        self.assertEqual(
            failures,
            [f"{manifest_path}: namespaces.ui.uri target does not exist: ./ui.json"],
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

    def test_abi_export_plan_scopes_contract_names_by_dapp_source_path(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            for dapp in ("one", "two"):
                dapp_root = root / dapp
                (dapp_root / "src").mkdir(parents=True)
                (dapp_root / "cam" / "abi").mkdir(parents=True)
                (dapp_root / "src" / "AppUI.sol").write_text("contract AppUI {}\n", encoding="utf-8")
                (dapp_root / "cam" / "main.json").write_text(
                    '{"namespaces":{"contracts.AppUI":{"type":"contract","abiURI":"./abi/AppUI.json"}}}\n',
                    encoding="utf-8",
                )

            self.assertEqual(
                [row.as_tsv() for row in build_abi_plan_rows(root)],
                [
                    "one\tone/src/AppUI.sol:AppUI\tAppUI.json\n",
                    "two\ttwo/src/AppUI.sol:AppUI\tAppUI.json\n",
                ],
            )

    def test_resource_integrity_checks_sha256_digests(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            (abi_dir / "UI.json").write_text("[]\n", encoding="utf-8")
            (manifest_path.parent / "ui.json").write_text('{"ui":"1.0.0","nodes":{}}\n', encoding="utf-8")

            failures = self.validator.validate_resource_integrity(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
                        },
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                            "integrity": "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
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

ZERO_SHA256 = "sha256:0x0000000000000000000000000000000000000000000000000000000000000000"
