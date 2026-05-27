from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
from tools.cam_abi_plan import build_abi_plan_rows


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_route_functions_match_declared_abis(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_route_functions_match_declared_abis)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_route_function_checker_fails_closed_on_malformed_prerequisites(self) -> None:
        manifest = Path("dapps/example/cam/main.json")

        self.assertEqual(
            self.validator.validate_route_functions_match_declared_abis(manifest, {"contracts": [], "routes": []}),
            [
                "dapps/example/cam/main.json: contracts must be an object",
                "dapps/example/cam/main.json: routes must be an object",
            ],
        )

        failures = self.validator.validate_route_functions_match_declared_abis(
            manifest,
            {
                "contracts": {
                    "Example": {
                        "abiURI": "./abi/Missing.json",
                    }
                },
                "routes": {
                    "entry": {
                        "contract": "Example",
                        "function": "viewEntry",
                        "args": [],
                    }
                },
            },
        )

        self.assertIn(
            "dapps/example/cam/main.json: contracts.Example.abiURI target does not exist: ./abi/Missing.json",
            failures,
        )
        self.assertIn(
            "dapps/example/cam/main.json: routes.entry.contract has no readable ABI function map: Example",
            failures,
        )

    def test_generated_abi_convention_checker_fails_closed_on_malformed_contracts(self) -> None:
        manifest = Path("dapps/example/cam/main.json")

        self.assertEqual(
            self.validator.validate_generated_abi_uri_conventions(
                manifest,
                {
                    "contracts": {
                        "Broken": [],
                    }
                },
            ),
            ["dapps/example/cam/main.json: contracts.Broken must be an object"],
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
