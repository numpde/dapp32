from __future__ import annotations

import json
import re
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .common import protocol_document_version, read_text, repo_path, ts_exported_string_constants
from tools.cam_resource_integrity import (
    CONTRACT_NAMESPACE_PREFIX,
    CamResourceIntegrityError,
    MAX_CAM_RESOURCE_BYTES,
    ROUTES_NAMESPACE,
    UI_NAMESPACE,
    refresh_manifest,
)
from tools.json_policy import read_strict_json


class CamResourceIntegrityToolTest(unittest.TestCase):
    def test_python_namespace_constants_match_protocol_runtime_constants(self) -> None:
        protocol_source = read_text(repo_path("js/packages/cam-protocol/src/namespaces.ts"))

        # The refresh tool classifies namespace declarations before hashing
        # resources. If these names drift from the protocol constants,
        # publication can refresh a manifest viewers will later reject.
        self.assertEqual(
            {
                "CAM_CONTRACT_NAMESPACE_PREFIX": CONTRACT_NAMESPACE_PREFIX,
                "CAM_ROUTES_NAMESPACE": ROUTES_NAMESPACE,
                "CAM_UI_NAMESPACE": UI_NAMESPACE,
            },
            ts_exported_string_constants(protocol_source),
        )

    def test_python_resource_size_cap_matches_protocol_runtime_cap(self) -> None:
        protocol_source = read_text(repo_path("js/packages/cam-protocol/src/resources.ts"))
        match = re.search(r"export const CAM_RESOURCE_MAX_BYTES = (?P<expression>[0-9 *]+)$", protocol_source, re.MULTILINE)
        self.assertIsNotNone(match, "CAM_RESOURCE_MAX_BYTES must stay a simple numeric expression")
        assert match is not None

        # The Python refresh tool cannot import TypeScript, but it must enforce
        # the same byte cap as runtime loaders so a manifest cannot pass one
        # publication lane and fail the viewer.
        protocol_limit = numeric_product(match.group("expression"))
        self.assertEqual(protocol_limit, MAX_CAM_RESOURCE_BYTES)

    def test_refresh_manifest_updates_contract_and_ui_resource_hashes(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            (manifest_path.parent / "abi").mkdir(parents=True)
            (manifest_path.parent / "abi" / "UI.json").write_text("[]\n", encoding="utf-8")
            (manifest_path.parent / "ui.json").write_text(
                json.dumps({"ui": protocol_document_version("UI_VERSION"), "nodes": {}}) + "\n",
                encoding="utf-8",
            )
            write_json(
                manifest_path,
                {
                    "cam": protocol_document_version("CAM_VERSION"),
                    "entry": "entry",
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                            "integrity": ZERO_SHA256,
                        },
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                            "integrity": ZERO_SHA256,
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
            ZERO_SHA256,
            namespaces["contracts.UI"]["integrity"],
        )
        self.assertNotEqual(
            ZERO_SHA256,
            namespaces["ui"]["integrity"],
        )

    def test_refresh_manifest_rejects_resource_escape(self) -> None:
        for uri, message in (
            ("./../UI.json", "must stay under the CAM directory"),
            ("./%2e%2e/UI.json", "must not contain percent-encoded path text"),
            ("./abi\\UI.json", "must not contain backslash path separators"),
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

    def test_refresh_manifest_rejects_symlinked_manifest_path_components(self) -> None:
        for component in ("dapp", "cam", "main.json"):
            with self.subTest(component=component), TemporaryDirectory() as tmp:
                root = Path(tmp)
                outside = root / "outside"
                outside.joinpath("cam").mkdir(parents=True)
                outside.joinpath("cam", "main.json").write_text("{}", encoding="utf-8")

                dapp = root / "dapp"
                if component == "dapp":
                    dapp.symlink_to(outside, target_is_directory=True)
                    manifest_path = dapp / "cam" / "main.json"
                elif component == "cam":
                    dapp.mkdir()
                    dapp.joinpath("cam").symlink_to(outside / "cam", target_is_directory=True)
                    manifest_path = dapp / "cam" / "main.json"
                else:
                    dapp.joinpath("cam").mkdir(parents=True)
                    dapp.joinpath("cam", "main.json").symlink_to(outside / "cam" / "main.json")
                    manifest_path = dapp / "cam" / "main.json"

                with self.assertRaisesRegex(CamResourceIntegrityError, "refusing symlinked CAM manifest path"):
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
                        "contracts.UI-v1": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                        },
                    },
                },
            )

            with self.assertRaisesRegex(CamResourceIntegrityError, "contract namespace name must be one identifier"):
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


def numeric_product(expression: str) -> int:
    result = 1
    for term in expression.split("*"):
        result *= int(term.strip())

    return result


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
