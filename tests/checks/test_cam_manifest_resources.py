from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
from tools.cam_abi_plan import build_abi_plan_rows


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_manifests_match_declared_abis_and_resource_inventory(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_declared_abi_usage),
            *self.validator.collect_manifest_failures(self.validator.validate_resource_inventory),
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

    def test_namespaced_route_calls_must_match_declared_abis(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            write_json(
                abi_dir / "UI.json",
                [
                    {
                        "type": "function",
                        "name": "viewEntry",
                        "stateMutability": "view",
                        "inputs": [{"name": "account", "type": "address"}],
                        "outputs": [{"name": "view", "type": "tuple", "components": []}],
                    },
                ],
            )
            write_json(
                abi_dir / "Manager.json",
                [
                    {
                        "type": "function",
                        "name": "readOnly",
                        "stateMutability": "view",
                        "inputs": [],
                        "outputs": [],
                    },
                ],
            )

            failures = self.validator.validate_declared_abi_usage(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                        },
                        "contracts.Manager": {
                            "type": "contract",
                            "abiURI": "./abi/Manager.json",
                        },
                    },
                    "routes": {
                        "entry": {
                            "call": {
                                "namespace": "contracts.UI",
                                "function": "viewEntry",
                                "args": {},
                            },
                            "then": {
                                "namespace": "ui",
                            },
                        },
                        "badWrite": {
                            "call": {
                                "namespace": "contracts.Manager",
                                "function": "readOnly",
                                "args": {"extra": "x"},
                            },
                            "then": {
                                "namespace": "routes",
                            },
                        },
                        "missing": {
                            "call": {
                                "namespace": "contracts.Manager",
                                "function": "missing",
                                "args": {},
                            },
                            "then": {
                                "namespace": "routes",
                            },
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: routes.entry.call.args has 0 item(s), but UI.viewEntry expects 1",
                f"{manifest_path}: routes.badWrite.call.args has 1 item(s), but Manager.readOnly expects 0",
                f"{manifest_path}: write route must target a payable or nonpayable ABI function "
                f"at routes.badWrite.call: Manager.readOnly",
                f"{manifest_path}: write route has 1 arg(s), but Manager.readOnly expects 0 "
                f"at routes.badWrite.call",
                f"{manifest_path}: route call function is not present in Manager ABI at routes.missing.call: missing",
            ],
        )


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
