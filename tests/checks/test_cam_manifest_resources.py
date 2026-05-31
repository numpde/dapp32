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

    def test_cam_manifests_match_declared_abis_and_screen_inventory(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_route_functions_match_declared_abis),
            *self.validator.collect_manifest_failures(self.validator.validate_screen_contract_actions_match_declared_abis),
            *self.validator.collect_manifest_failures(self.validator.validate_route_screen_inventory),
        ]

        if failures:
            self.fail("\n".join(failures))

    def test_screen_inventory_accepts_route_owned_screen_families(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            screen_dir = manifest_path.parent / "screens"
            screen_dir.mkdir(parents=True)
            (screen_dir / "entry.json").write_text("{}\n", encoding="utf-8")
            (screen_dir / "component.empty.json").write_text("{}\n", encoding="utf-8")
            (screen_dir / "component.found.json").write_text("{}\n", encoding="utf-8")
            (screen_dir / "orphan.json").write_text("{}\n", encoding="utf-8")

            failures = self.validator.validate_route_screen_inventory(
                manifest_path,
                {
                    "routes": {
                        "entry": {},
                        "component": {},
                    },
                },
            )

        self.assertEqual(failures, [f"{manifest_path}: CAM screen has no matching route: screens/orphan.json"])

    def test_screen_inventory_rejects_ambiguous_route_families(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            screen_dir = manifest_path.parent / "screens"
            screen_dir.mkdir(parents=True)
            (screen_dir / "component.found.json").write_text("{}\n", encoding="utf-8")

            failures = self.validator.validate_route_screen_inventory(
                manifest_path,
                {
                    "routes": {
                        "component": {},
                        "component.found": {},
                    },
                },
            )

        self.assertEqual(
            failures,
            [f"{manifest_path}: CAM screen matches multiple routes: screens/component.found.json -> component, component.found"],
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
                    '{"contracts":{"AppUI":{"abiURI":"./abi/AppUI.json"}}}\n',
                    encoding="utf-8",
                )

            self.assertEqual(
                [row.as_tsv() for row in build_abi_plan_rows(root)],
                [
                    "one\tone/src/AppUI.sol:AppUI\tAppUI.json\n",
                    "two\ttwo/src/AppUI.sol:AppUI\tAppUI.json\n",
                ],
            )

    def test_screen_contract_actions_must_match_declared_abis(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            screen_dir = manifest_path.parent / "screens"
            abi_dir.mkdir(parents=True)
            screen_dir.mkdir()
            write_json(
                abi_dir / "Manager.json",
                [
                    {
                        "type": "function",
                        "name": "writeOne",
                        "stateMutability": "nonpayable",
                        "inputs": [{"name": "serialNumber", "type": "string"}],
                        "outputs": [],
                    },
                    {
                        "type": "function",
                        "name": "readOnly",
                        "stateMutability": "view",
                        "inputs": [],
                        "outputs": [],
                    },
                ],
            )
            write_json(
                screen_dir / "entry.json",
                {
                    "screen": "1.0.0",
                    "elements": [
                        {
                            "type": "button",
                            "label": "Broken",
                            "action": {
                                "type": "contract-call",
                                "contract": "Manager",
                                "function": "readOnly",
                                "args": ["extra"],
                            },
                        },
                        {
                            "type": "button",
                            "label": "Missing",
                            "action": {
                                "type": "contract-call",
                                "contract": "Manager",
                                "function": "missing",
                                "args": [],
                            },
                        },
                    ],
                },
            )

            failures = self.validator.validate_screen_contract_actions_match_declared_abis(
                manifest_path,
                {
                    "contracts": {
                        "Manager": {
                            "abiURI": "./abi/Manager.json",
                        },
                    },
                    "routes": {
                        "entry": {},
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: contract-call action must target a payable or nonpayable ABI function "
                f"at {screen_dir / 'entry.json'}:elements.0.action: Manager.readOnly",
                f"{manifest_path}: contract-call action has 1 arg(s), but Manager.readOnly expects 0 "
                f"at {screen_dir / 'entry.json'}:elements.0.action",
                f"{manifest_path}: contract-call action function is not present in Manager ABI "
                f"at {screen_dir / 'entry.json'}:elements.1.action: missing",
            ],
        )


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
