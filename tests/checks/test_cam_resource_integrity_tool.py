from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tools.cam_resource_integrity import CamResourceIntegrityError, refresh_manifest
from tools.json_policy import read_strict_json


class CamResourceIntegrityToolTest(unittest.TestCase):
    def test_refresh_manifest_updates_contract_and_ui_resource_hashes(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            (manifest_path.parent / "abi").mkdir(parents=True)
            (manifest_path.parent / "abi" / "UI.json").write_text("[]\n", encoding="utf-8")
            (manifest_path.parent / "ui.json").write_text('{"ui":"1.0.0","nodes":{}}\n', encoding="utf-8")
            write_json(
                manifest_path,
                {
                    "cam": "1.0.0",
                    "entry": "entry",
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
                    "routes": {},
                },
            )

            self.assertTrue(refresh_manifest(manifest_path))
            updated = read_strict_json(manifest_path)

        self.assertIsInstance(updated, dict)
        namespaces = updated["namespaces"]
        self.assertIsInstance(namespaces, dict)
        self.assertNotEqual(
            "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
            namespaces["contracts.UI"]["integrity"],
        )
        self.assertNotEqual(
            "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
            namespaces["ui"]["integrity"],
        )

    def test_refresh_manifest_rejects_resource_escape(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)
            write_json(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./../UI.json",
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "must stay under the CAM directory"):
                refresh_manifest(manifest_path)

    def test_refresh_manifest_rejects_malformed_namespaces(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)
            write_json(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "ui",
                            "abiURI": "./abi/UI.json",
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "namespaces.contracts.UI.type must be contract"):
                refresh_manifest(manifest_path)

            write_json(
                manifest_path,
                {
                    "namespaces": {
                        "widgets": {
                            "type": "ui",
                            "uri": "./ui.json",
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "unsupported namespace: widgets"):
                refresh_manifest(manifest_path)


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
