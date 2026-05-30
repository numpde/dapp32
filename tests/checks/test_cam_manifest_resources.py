from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
from tools.cam_abi_plan import build_abi_plan_rows


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_routes_match_declared_abis_and_screen_inventory(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_route_functions_match_declared_abis),
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
