from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tools.cam_resource_integrity import CamResourceIntegrityError, MAX_CAM_RESOURCE_BYTES, refresh_manifest
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
        for uri, message in (
            ("./../UI.json", "must stay under the CAM directory"),
            ("./%2e%2e/UI.json", "must not contain percent-encoded path text"),
        ):
            with self.subTest(uri=uri), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir(parents=True)
                write_json(
                    manifest_path,
                    {
                        "namespaces": {
                            "contracts.UI": {
                                "type": "contract",
                                "abiURI": uri,
                                "integrity": ZERO_SHA256,
                            },
                        },
                    },
                )

                with self.assertRaisesRegex(CamResourceIntegrityError, message):
                    refresh_manifest(manifest_path)

    def test_refresh_manifest_rejects_symlinked_resource_path_components(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            manifest_path = root / "cam" / "main.json"
            outside = root / "outside"
            outside.mkdir()
            outside.joinpath("UI.json").write_text("[]\n", encoding="utf-8")
            manifest_path.parent.mkdir(parents=True)
            manifest_path.parent.joinpath("abi").symlink_to(outside, target_is_directory=True)
            write_json(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": ZERO_SHA256,
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "refusing symlinked CAM resource path"):
                refresh_manifest(manifest_path)

    def test_refresh_manifest_requires_existing_well_formed_integrity_fields(self) -> None:
        malformed_values = [None, "", "sha256:0x0", "sha256:0x" + ("A" * 64)]
        for value in malformed_values:
            with self.subTest(value=value), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                (manifest_path.parent / "abi").mkdir(parents=True)
                (manifest_path.parent / "abi" / "UI.json").write_text("[]\n", encoding="utf-8")
                declaration: dict[str, object] = {
                    "type": "contract",
                    "abiURI": "./abi/UI.json",
                }
                if value is not None:
                    declaration["integrity"] = value
                write_json(
                    manifest_path,
                    {
                        "namespaces": {
                            "contracts.UI": declaration,
                        },
                    },
                )

                with self.assertRaisesRegex(CamResourceIntegrityError, "integrity must be"):
                    refresh_manifest(manifest_path)

    def test_refresh_manifest_rejects_resources_larger_than_runtime_limit(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            (manifest_path.parent / "abi").mkdir(parents=True)
            (manifest_path.parent / "abi" / "UI.json").write_bytes(b"0" * (MAX_CAM_RESOURCE_BYTES + 1))
            write_json(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": ZERO_SHA256,
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "CAM resource is too large"):
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


ZERO_SHA256 = "sha256:0x0000000000000000000000000000000000000000000000000000000000000000"


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
