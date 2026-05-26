from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import AbiRouteFunction, CamManifestResourceValidator
from .common import repo_path
from tools.cam_abi_plan import build_abi_plan_rows


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_local_cam_contract_abi_uris_resolve_to_checked_in_abi_arrays(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_manifest_abi_uris)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_contract_abi_uris_follow_generated_resource_convention(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_generated_abi_uri_conventions)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_abi_directories_contain_only_manifest_referenced_files(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_no_orphan_abi_files)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_route_functions_match_declared_abis(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_route_functions_match_declared_abis)

        if failures:
            self.fail("\n".join(failures))

    def test_checked_in_cam_screens_follow_screen_v1_schema(self) -> None:
        failures = self.validator.collect_manifest_failures(self.validator.validate_manifest_screens)

        if failures:
            self.fail("\n".join(failures))

    def test_cam_manifest_resource_checker_self_check(self) -> None:
        manifest = repo_path("dapps/example/cam/main.json")

        self.assertIsNone(
            self.validator.validate_local_abi_uri(
                manifest,
                "Example",
                "./abi/Example.json",
                existing_files={repo_path("dapps/example/cam/abi/Example.json")},
                abi_documents={repo_path("dapps/example/cam/abi/Example.json"): []},
            )
        )

        rejected = [
            ("Missing", None),
            ("Absolute", "/tmp/Example.json"),
            ("Remote", "https://example.test/Example.json"),
            ("Escape", "../abi/Example.json"),
            ("WrongSuffix", "./abi/Example.txt"),
            ("MissingFile", "./abi/Missing.json"),
        ]
        for contract_name, abi_uri in rejected:
            with self.subTest(contract_name=contract_name):
                self.assertIsNotNone(
                    self.validator.validate_local_abi_uri(
                        manifest,
                        contract_name,
                        abi_uri,
                        existing_files={repo_path("dapps/example/cam/abi/Example.json")},
                        abi_documents={repo_path("dapps/example/cam/abi/Example.json"): []},
                    )
                )

        self.assertIsNone(
            self.validator.validate_local_abi_uri(
                manifest,
                "Example",
                "./custom/Example.json",
                existing_files={repo_path("dapps/example/cam/custom/Example.json")},
                abi_documents={repo_path("dapps/example/cam/custom/Example.json"): []},
            )
        )

        convention_rejected = [
            ("WrongDirectory", "Example", "./custom/Example.json"),
            ("WrongBasename", "Example", "./abi/Other.json"),
        ]
        for case_name, contract_name, abi_uri in convention_rejected:
            with self.subTest(case_name=case_name):
                self.assertIsNotNone(
                    self.validator.validate_generated_abi_uri_convention(manifest, contract_name, abi_uri)
                )

        self.assertIsNotNone(
            self.validator.validate_local_abi_uri(
                manifest,
                "ObjectAbi",
                "./abi/ObjectAbi.json",
                existing_files={repo_path("dapps/example/cam/abi/ObjectAbi.json")},
                abi_documents={repo_path("dapps/example/cam/abi/ObjectAbi.json"): {}},
            )
        )

        self.assertEqual(
            self.validator.abi_route_functions(
                [
                    {
                        "type": "function",
                        "name": "viewEntry",
                        "stateMutability": "view",
                        "inputs": [{"type": "address"}],
                    },
                    {"type": "event", "name": "Ignored", "inputs": []},
                    {"type": "function", "name": "overloaded", "stateMutability": "view", "inputs": []},
                    {
                        "type": "function",
                        "name": "overloaded",
                        "stateMutability": "view",
                        "inputs": [{"type": "string"}],
                    },
                ]
            ),
            {
                "viewEntry": AbiRouteFunction(input_count=1, state_mutability="view", outputs=()),
                "overloaded": None,
            },
        )

        self.assertEqual(
            self.validator.validate_route_output_shape(
                manifest,
                "routes.entry",
                "Example",
                "viewEntry",
                AbiRouteFunction(
                    input_count=1,
                    state_mutability="view",
                    outputs=({"name": "screenURI", "type": "string"},),
                ),
            ),
            [],
        )
        self.assertEqual(
            self.validator.validate_route_function_mutability(
                manifest,
                "routes.entry",
                "Example",
                "viewEntry",
                AbiRouteFunction(
                    input_count=1,
                    state_mutability="nonpayable",
                    outputs=({"name": "screenURI", "type": "string"},),
                ),
            ),
            [f"{manifest}: routes.entry.function must be view or pure in Example ABI: viewEntry"],
        )

        bad_first_outputs = [
            ("MissingOutputs", None),
            ("WrongName", {"name": "uri", "type": "string"}),
            ("WrongType", {"name": "screenURI", "type": "bytes32"}),
            ("MalformedOutput", "screenURI"),
        ]
        for case_name, first_output in bad_first_outputs:
            with self.subTest(case_name=case_name):
                self.assertTrue(
                    self.validator.validate_route_output_shape(
                        manifest,
                        "routes.entry",
                        "Example",
                        "viewEntry",
                        AbiRouteFunction(
                            input_count=1,
                            state_mutability="view",
                            outputs=() if first_output is None else (first_output,),
                        ),
                    )
                )

        route_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.exists"},
                {"type": "status", "value": "$values.1"},
            ],
        }
        route_function = AbiRouteFunction(
            input_count=0,
            state_mutability="view",
            outputs=(
                {"name": "screenURI", "type": "string"},
                {
                    "name": "component",
                    "type": "tuple",
                    "components": [{"name": "exists", "type": "bool"}],
                },
                {"name": "count", "type": "uint256"},
            ),
        )
        self.assertEqual(
            self.validator.validate_screen_values_references(
                manifest,
                "routes.entry",
                manifest.parent / "screens" / "entry.json",
                route_screen,
                "Example",
                "viewEntry",
                route_function,
            ),
            [],
        )

        bad_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.missing"},
                {"type": "status", "value": "$values.1.count"},
                {"type": "status", "value": "$values.2"},
            ],
        }
        failures = self.validator.validate_screen_values_references(
            manifest,
            "routes.entry",
            manifest.parent / "screens" / "entry.json",
            bad_screen,
            "Example",
            "viewEntry",
            route_function,
        )
        self.assertEqual(len(failures), 3)

        screen_path = manifest.parent / "screens" / "entry.json"
        self.assertEqual(
            self.validator.validate_screen_document(
                screen_path,
                {
                    "screen": "1.0.0",
                    "title": "$params.serialNumber",
                    "elements": [
                        {"type": "text", "text": "Component"},
                        {"type": "input", "name": "serialNumber", "label": "Serial number", "value": "$state.serialNumber"},
                        {
                            "type": "button",
                            "label": "Look up",
                            "action": {"route": "component", "params": {"serialNumber": "$state.serialNumber"}},
                        },
                    ],
                },
            ),
            [],
        )
        self.assertEqual(
            len(
                self.validator.validate_screen_document(
                    screen_path,
                    {
                        "screen": "1.0.0",
                        "layout": {},
                        "elements": [
                            {"type": "html", "html": "<b>unsafe</b>"},
                            {"type": "button", "label": "Bad", "action": {"route": "x", "contract": "Y"}},
                            {"type": "status", "value": "$bad.root"},
                        ],
                    },
                )
            ),
            4,
        )

        self.assertEqual(
            self.validator.validate_no_orphan_abi_files(
                manifest,
                {
                    "contracts": {
                        "Example": {
                            "abiURI": "./abi/Example.json",
                        }
                    }
                },
                existing_files={
                    repo_path("dapps/example/cam/abi/Example.json"),
                    repo_path("dapps/example/cam/abi/Unused.json"),
                },
            ),
            [f"{manifest}: cam/abi contains unused ABI file not referenced by contracts.*.abiURI: Unused.json"],
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
