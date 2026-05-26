from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
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
