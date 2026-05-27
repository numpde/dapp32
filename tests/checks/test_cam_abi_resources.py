from __future__ import annotations

import unittest

from .cam_abi_resources import validate_generated_abi_uri_convention
from .cam_abi_resources import validate_local_abi_uri
from .cam_abi_resources import validate_no_orphan_abi_files
from .cam_manifest_resources import CamManifestResourceValidator
from .common import repo_path


class CamAbiResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()
        self.manifest = repo_path("dapps/example/cam/main.json")
        self.abi_path = repo_path("dapps/example/cam/abi/Example.json")

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

    def test_local_abi_uri_must_resolve_to_checked_in_abi_array(self) -> None:
        self.assertIsNone(
            validate_local_abi_uri(
                self.manifest,
                "Example",
                "./abi/Example.json",
                existing_files={self.abi_path},
                abi_documents={self.abi_path: []},
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
                    validate_local_abi_uri(
                        self.manifest,
                        contract_name,
                        abi_uri,
                        existing_files={self.abi_path},
                        abi_documents={self.abi_path: []},
                    )
                )

        self.assertIsNone(
            validate_local_abi_uri(
                self.manifest,
                "Example",
                "./custom/Example.json",
                existing_files={repo_path("dapps/example/cam/custom/Example.json")},
                abi_documents={repo_path("dapps/example/cam/custom/Example.json"): []},
            )
        )

        self.assertIsNotNone(
            validate_local_abi_uri(
                self.manifest,
                "ObjectAbi",
                "./abi/ObjectAbi.json",
                existing_files={repo_path("dapps/example/cam/abi/ObjectAbi.json")},
                abi_documents={repo_path("dapps/example/cam/abi/ObjectAbi.json"): {}},
            )
        )

    def test_generated_abi_uri_convention_is_manifest_contract_name(self) -> None:
        convention_rejected = [
            ("WrongDirectory", "Example", "./custom/Example.json"),
            ("WrongBasename", "Example", "./abi/Other.json"),
        ]
        for case_name, contract_name, abi_uri in convention_rejected:
            with self.subTest(case_name=case_name):
                self.assertIsNotNone(validate_generated_abi_uri_convention(self.manifest, contract_name, abi_uri))

    def test_cam_abi_directory_must_not_contain_orphans(self) -> None:
        self.assertEqual(
            validate_no_orphan_abi_files(
                self.manifest,
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
            [f"{self.manifest}: cam/abi contains unused ABI file not referenced by contracts.*.abiURI: Unused.json"],
        )

        self.assertEqual(
            validate_no_orphan_abi_files(
                self.manifest,
                {"contracts": []},
                existing_files=set(),
            ),
            [f"{self.manifest}: contracts must be an object"],
        )

        self.assertEqual(
            validate_no_orphan_abi_files(
                self.manifest,
                {
                    "contracts": {
                        "Broken": {},
                    }
                },
                existing_files=set(),
            ),
            [f"{self.manifest}: contracts.Broken.abiURI must be a non-empty string"],
        )

        self.assertEqual(
            validate_no_orphan_abi_files(
                self.manifest,
                {
                    "contracts": {
                        "Escaped": {
                            "abiURI": "../abi/Escaped.json",
                        }
                    }
                },
                existing_files=set(),
            ),
            [
                f"{self.manifest}: contracts.Escaped.abiURI must not be absolute "
                "or contain unsafe path segments: ../abi/Escaped.json"
            ],
        )

        self.assertEqual(
            validate_no_orphan_abi_files(
                self.manifest,
                {
                    "contracts": {
                        "Missing": {
                            "abiURI": "./abi/Missing.json",
                        }
                    }
                },
                existing_files=set(),
            ),
            [f"{self.manifest}: contracts.Missing.abiURI target does not exist: ./abi/Missing.json"],
        )


if __name__ == "__main__":
    unittest.main()
