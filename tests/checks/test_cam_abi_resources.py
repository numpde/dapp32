from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from .cam_abi_resources import validate_local_abi_uri
from .cam_manifest_resources import CamManifestResourceValidator


class CamAbiResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_abi_resources_are_checked_in_and_manifest_referenced(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_manifest_abi_uris),
            *self.validator.collect_manifest_failures(self.validator.validate_no_orphan_abi_files),
        ]

        if failures:
            self.fail("\n".join(failures))

    def test_abi_uri_reuses_cam_resource_path_policy(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = root / "cam" / "main.json"
            outside = root / "outside"
            outside.mkdir()
            outside.joinpath("UI.json").write_text("[]\n", encoding="utf-8")
            manifest_path.parent.mkdir(parents=True)
            manifest_path.parent.joinpath("abi").symlink_to(outside, target_is_directory=True)

            failures = validate_local_abi_uri(manifest_path, "UI", "./abi/UI.json")

        self.assertEqual(
            failures,
            [f"{manifest_path}: refusing symlinked CAM resource path: ./abi/UI.json"],
        )

    def test_abi_uri_must_match_contract_namespace_name(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"

            wrong_directory = validate_local_abi_uri(manifest_path, "UI", "./generated/UI.json")
            wrong_basename = validate_local_abi_uri(manifest_path, "UI", "./abi/App.json")

        self.assertEqual(
            wrong_directory,
            [f"{manifest_path}: namespaces.contracts.UI.abiURI must target ./abi/UI.json"],
        )
        self.assertEqual(
            wrong_basename,
            [f"{manifest_path}: namespaces.contracts.UI.abiURI must be ./abi/UI.json"],
        )


if __name__ == "__main__":
    unittest.main()
