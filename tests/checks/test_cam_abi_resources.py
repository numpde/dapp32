from __future__ import annotations

from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

from .cam_abi_resources import validate_local_abi_uri
from .cam_manifest_resources import CamManifestResourceValidator
from .common import ROOT
from tools.cam_abi_plan import build_abi_plan_rows


class CamAbiResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_isolated_cli_writes_the_manifest_declared_export_plan(self) -> None:
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "manifest.tsv"
            completed = subprocess.run(
                [sys.executable, "-I", "-B", str(ROOT / "tools/forge-abi-plan.py"), str(ROOT / "dapps"), str(output)],
                cwd=tmp, capture_output=True, text=True, check=True, timeout=10,
            )
            rows = build_abi_plan_rows(ROOT / "dapps")
            self.assertTrue(rows)
            self.assertEqual("".join(row.as_tsv() for row in rows), output.read_text())
            self.assertIn(f"wrote {len(rows)} manifest-declared ABI target(s)", completed.stdout)

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

            # Forge inspect targets are source-qualified so independent dapps
            # can reuse ordinary contract names without a global naming regime.
            self.assertEqual(
                [row.as_tsv() for row in build_abi_plan_rows(root)],
                [
                    "one\tone/src/AppUI.sol:AppUI\tAppUI.json\n",
                    "two\ttwo/src/AppUI.sol:AppUI\tAppUI.json\n",
                ],
            )

    def test_abi_export_plan_rejects_dapp_names_that_cannot_be_plan_fields(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            dapp_root = root / "bad\tname"
            (dapp_root / "src").mkdir(parents=True)
            (dapp_root / "cam" / "abi").mkdir(parents=True)
            (dapp_root / "src" / "AppUI.sol").write_text("contract AppUI {}\n", encoding="utf-8")
            (dapp_root / "cam" / "main.json").write_text(
                '{"namespaces":{"contracts.AppUI":{"type":"contract","abiURI":"./abi/AppUI.json"}}}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "invalid ABI export dapp directory name"):
                build_abi_plan_rows(root)

    def test_abi_export_plan_rejects_invalid_roots(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "real-dapps"
            target.mkdir()
            link = root / "dapps"
            link.symlink_to(target, target_is_directory=True)

            with self.assertRaisesRegex(ValueError, "refusing symlinked ABI export root"):
                build_abi_plan_rows(link)

            with self.assertRaisesRegex(ValueError, "ABI export root is not a directory"):
                build_abi_plan_rows(root / "missing")


if __name__ == "__main__":
    unittest.main()
