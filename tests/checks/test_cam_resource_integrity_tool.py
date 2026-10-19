from __future__ import annotations

import hashlib
import json
import re
import unittest
from unittest.mock import patch
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
    def add_current_protocol(self, manifest_path: Path, document: dict[str, object]) -> None:
        manifest_path.parent.joinpath("protocol.html").write_bytes(b"previous protocol")
        document["cam"] = protocol_document_version("CAM_VERSION")
        document["protocol"] = {"uri": "./protocol.html", "integrity": ZERO_SHA256}

    def test_refresh_rejects_missing_protocol_and_retired_cam_without_writes(self) -> None:
        missing = object()
        cases = (
            ("missing protocol", "1.2.0", missing),
            ("null protocol", "1.2.0", None),
            ("missing protocol on retired CAM", "1.1.0", missing),
            ("retired CAM 1.0 with protocol", "1.0.0", {"uri": "./protocol.html", "integrity": ZERO_SHA256}),
            ("retired CAM 1.1 with protocol", "1.1.0", {"uri": "./protocol.html", "integrity": ZERO_SHA256}),
            ("unsupported CAM 2.0 with protocol", "2.0.0", {"uri": "./protocol.html", "integrity": ZERO_SHA256}),
        )
        for label, version, protocol in cases:
            with self.subTest(case=label), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir()
                protocol_path = manifest_path.parent / "protocol.html"
                protocol_path.write_bytes(b"previous protocol")
                ui_path = manifest_path.parent / "ui.json"
                ui_path.write_bytes(b"{}")
                document = {
                    "cam": version,
                    "namespaces": {
                        "ui": {"type": "ui", "uri": "./ui.json", "integrity": ZERO_SHA256},
                    },
                }
                if protocol is not missing:
                    document["protocol"] = protocol
                write_json(manifest_path, document)
                manifest_before = manifest_path.read_bytes()

                with self.assertRaises(CamResourceIntegrityError):
                    refresh_manifest(manifest_path)

                self.assertEqual(manifest_before, manifest_path.read_bytes())
                self.assertEqual(b"previous protocol", protocol_path.read_bytes())

    def test_refresh_rejects_non_object_protocol_without_writes(self) -> None:
        malformed_values = (
            "./protocol.html",
            [],
            {},
            {"uri": "./protocol.html", "integrity": ZERO_SHA256, "extra": True},
        )
        for protocol in malformed_values:
            with self.subTest(protocol=protocol), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir()
                protocol_path = manifest_path.parent / "protocol.html"
                protocol_path.write_bytes(b"previous protocol")
                ui_path = manifest_path.parent / "ui.json"
                ui_path.write_bytes(b"{}")
                write_json(manifest_path, {
                    "cam": "1.2.0",
                    "protocol": protocol,
                    "namespaces": {
                        "ui": {"type": "ui", "uri": "./ui.json", "integrity": ZERO_SHA256},
                    },
                })
                manifest_before = manifest_path.read_bytes()

                with self.assertRaises(CamResourceIntegrityError):
                    refresh_manifest(manifest_path)

                self.assertEqual(manifest_before, manifest_path.read_bytes())
                self.assertEqual(b"previous protocol", protocol_path.read_bytes())

    def test_refresh_rejects_overflowing_json_number_without_changing_outputs(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir()
            protocol_path = manifest_path.parent / "protocol.html"
            protocol_path.write_bytes(b"previous protocol")
            manifest_path.write_text(
                '{"cam":"1.2.0","protocol":{"uri":"./protocol.html","integrity":"'
                + ZERO_SHA256
                + '"},"namespaces":{},"extension":{"nested":[1e400]}}',
                encoding="utf-8",
            )
            manifest_before = manifest_path.read_bytes()
            protocol_before = protocol_path.read_bytes()

            with self.assertRaisesRegex(CamResourceIntegrityError, "outside the finite number range"):
                refresh_manifest(manifest_path)

            self.assertEqual(manifest_before, manifest_path.read_bytes())
            self.assertEqual(protocol_before, protocol_path.read_bytes())

    def test_invalid_resource_declarations_do_not_change_publication_outputs(self) -> None:
        for failure in (
            "protocol integrity", "namespace", "resource integrity",
            "missing resource", "missing ABI", "oversized resource",
        ):
            with self.subTest(failure=failure), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir()
                protocol_path = manifest_path.parent / "protocol.html"
                protocol_path.write_bytes(b"previous protocol")
                resource_path = manifest_path.parent / "ui.json"
                resource_path.write_bytes(b"{}")
                document = {
                    "cam": "1.2.0",
                    "protocol": {"uri": "./protocol.html", "integrity": ZERO_SHA256},
                    "namespaces": {"ui": {"type": "ui", "uri": "./ui.json", "integrity": ZERO_SHA256}},
                }
                if failure == "protocol integrity":
                    document["protocol"]["integrity"] = "invalid"
                elif failure == "namespace":
                    document["namespaces"]["ui"]["type"] = "contract"
                elif failure == "resource integrity":
                    document["namespaces"]["ui"]["integrity"] = "invalid"
                elif failure == "missing resource":
                    resource_path.unlink()
                elif failure == "missing ABI":
                    document["namespaces"]["contracts.Aux"] = {
                        "type": "contract", "abiURI": "./missing.json", "integrity": ZERO_SHA256,
                    }
                elif failure == "oversized resource":
                    resource_path.write_bytes(b"x" * (MAX_CAM_RESOURCE_BYTES + 1))
                write_json(manifest_path, document)
                manifest_before = manifest_path.read_bytes()

                with self.assertRaises(CamResourceIntegrityError):
                    refresh_manifest(manifest_path)

                self.assertEqual(manifest_before, manifest_path.read_bytes())
                self.assertEqual(b"previous protocol", protocol_path.read_bytes())

    def test_local_resource_query_and_fragment_markers_do_not_change_outputs(self) -> None:
        for marker in ("?draft=1", "#section", "?", "#"):
            with self.subTest(marker=marker), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir()
                protocol_path = manifest_path.parent / "protocol.html"
                ui_path = manifest_path.parent / f"ui.json{marker}"
                ui_path.write_bytes(b"{}")
                document: dict[str, object] = {
                    "namespaces": {
                        "ui": {
                            "type": "ui",
                            "uri": f"./{ui_path.name}",
                            "integrity": ZERO_SHA256,
                        },
                    },
                }
                self.add_current_protocol(manifest_path, document)
                write_json(manifest_path, document)
                manifest_before = manifest_path.read_bytes()
                protocol_before = protocol_path.read_bytes()

                with self.assertRaisesRegex(CamResourceIntegrityError, "must not contain query or fragment markers"):
                    refresh_manifest(manifest_path)

                self.assertEqual(manifest_before, manifest_path.read_bytes())
                self.assertEqual(protocol_before, protocol_path.read_bytes())

    def test_resource_referencing_protocol_is_pinned_to_the_published_bytes(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir()
            manifest_path.parent.joinpath("protocol.html").write_bytes(b"previous protocol")
            write_json(manifest_path, {
                "cam": "1.2.0",
                "protocol": {"uri": "./protocol.html", "integrity": ZERO_SHA256},
                "namespaces": {"ui": {"type": "ui", "uri": "./protocol.html", "integrity": ZERO_SHA256}},
            })

            self.assertTrue(refresh_manifest(manifest_path))
            published = read_strict_json(manifest_path)
            self.assertEqual(published["protocol"]["integrity"], published["namespaces"]["ui"]["integrity"])
            self.assertFalse(refresh_manifest(manifest_path))

    def test_oversized_canonical_protocol_does_not_change_publication_outputs(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir()
            protocol_path = manifest_path.parent / "protocol.html"
            protocol_path.write_bytes(b"previous protocol")
            write_json(manifest_path, {
                "cam": "1.2.0",
                "protocol": {"uri": "./protocol.html", "integrity": ZERO_SHA256},
                "namespaces": {},
            })
            manifest_before = manifest_path.read_bytes()
            canonical_path = Path(tmp) / "canonical.html"
            canonical_path.write_bytes(b"x" * (MAX_CAM_RESOURCE_BYTES + 1))
            with patch("tools.cam_resource_integrity.PROTOCOL_REFERENCE_PATH", canonical_path):
                with self.assertRaisesRegex(CamResourceIntegrityError, "protocol reference exceeds"):
                    refresh_manifest(manifest_path)
            self.assertEqual(manifest_before, manifest_path.read_bytes())
            self.assertEqual(b"previous protocol", protocol_path.read_bytes())

    def test_checked_in_protocol_copies_match_the_canonical_reference(self) -> None:
        canonical = repo_path("docs/reference/cam/1.2.0/index.html").read_bytes()
        for manifest_path in repo_path("dapps").glob("*/cam/main.json"):
            with self.subTest(manifest=manifest_path):
                self.assertEqual(canonical, (manifest_path.parent / "protocol.html").read_bytes())

    def test_refresh_manifest_copies_and_pins_the_canonical_protocol_bytes(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir()
            protocol_path = manifest_path.parent / "protocol.html"
            protocol_path.write_bytes(b"stale protocol")
            write_json(manifest_path, {
                "cam": "1.2.0",
                "protocol": {"uri": "./protocol.html", "integrity": ZERO_SHA256},
                "namespaces": {},
            })
            self.assertTrue(refresh_manifest(manifest_path))
            canonical = repo_path("docs/reference/cam/1.2.0/index.html").read_bytes()
            self.assertEqual(canonical, protocol_path.read_bytes())
            self.assertEqual(
                "sha256:0x" + hashlib.sha256(canonical).hexdigest(),
                read_strict_json(manifest_path)["protocol"]["integrity"],
            )
            self.assertFalse(refresh_manifest(manifest_path))

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
            document: dict[str, object] = {
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
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

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
            ("./../UI.json", "must use canonical CAM resource path segments"),
            ("./abi//UI.json", "must use canonical CAM resource path segments"),
            ("././abi/UI.json", "must use canonical CAM resource path segments"),
            ("./%2e%2e/UI.json", "must not contain percent-encoded path text"),
            ("./abi\\UI.json", "must not contain backslash path separators"),
        ):
            with self.subTest(uri=uri), TemporaryDirectory() as tmp:
                manifest_path = Path(tmp) / "cam" / "main.json"
                manifest_path.parent.mkdir(parents=True)
                document: dict[str, object] = {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": uri,
                            "integrity": ZERO_SHA256,
                        },
                    },
                }
                self.add_current_protocol(manifest_path, document)
                write_json(manifest_path, document)

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
            document: dict[str, object] = {
                "namespaces": {
                    "contracts.UI": {
                        "type": "contract",
                        "abiURI": "./abi/UI.json",
                        "integrity": ZERO_SHA256,
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

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
                document: dict[str, object] = {
                    "namespaces": {
                        "contracts.UI": declaration,
                    },
                }
                self.add_current_protocol(manifest_path, document)
                write_json(manifest_path, document)

                with self.assertRaisesRegex(CamResourceIntegrityError, "integrity must be"):
                    refresh_manifest(manifest_path)

    def test_refresh_manifest_rejects_resources_larger_than_runtime_limit(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            (manifest_path.parent / "abi").mkdir(parents=True)
            resource_uri = "./abi/UI.json"
            (manifest_path.parent / "abi" / "UI.json").write_bytes(b"0" * (MAX_CAM_RESOURCE_BYTES + 1))
            document: dict[str, object] = {
                "namespaces": {
                    "contracts.UI": {
                        "type": "contract",
                        "abiURI": resource_uri,
                        "integrity": ZERO_SHA256,
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

            with self.assertRaisesRegex(
                CamResourceIntegrityError,
                rf"{re.escape(str(manifest_path))}: CAM resource is too large: {re.escape(resource_uri)}",
            ):
                refresh_manifest(manifest_path)

    def test_refresh_manifest_hashes_exact_limit_resources(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            (manifest_path.parent / "abi").mkdir(parents=True)
            resource_bytes = b"0" * MAX_CAM_RESOURCE_BYTES
            (manifest_path.parent / "abi" / "UI.json").write_bytes(resource_bytes)
            document: dict[str, object] = {
                "namespaces": {
                    "contracts.UI": {
                        "type": "contract",
                        "abiURI": "./abi/UI.json",
                        "integrity": ZERO_SHA256,
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

            self.assertTrue(refresh_manifest(manifest_path))
            updated = read_strict_json(manifest_path)

        self.assertIsInstance(updated, dict)
        namespaces = updated["namespaces"]
        self.assertIsInstance(namespaces, dict)
        self.assertEqual(
            f"sha256:0x{sha256_hex(resource_bytes)}",
            namespaces["contracts.UI"]["integrity"],
        )

    def test_refresh_manifest_rejects_malformed_namespaces(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)
            document: dict[str, object] = {
                "namespaces": {
                    "contracts.UI": {
                        "type": "ui",
                        "abiURI": "./abi/UI.json",
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

            with self.assertRaisesRegex(CamResourceIntegrityError, "namespaces.contracts.UI.type must be contract"):
                refresh_manifest(manifest_path)

            document = {
                "namespaces": {
                    "contracts.UI-v1": {
                        "type": "contract",
                        "abiURI": "./abi/UI.json",
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

            with self.assertRaisesRegex(CamResourceIntegrityError, "contract namespace name must be one identifier"):
                refresh_manifest(manifest_path)

            document = {
                "namespaces": {
                    "widgets": {
                        "type": "ui",
                        "uri": "./ui.json",
                    },
                },
            }
            self.add_current_protocol(manifest_path, document)
            write_json(manifest_path, document)

            with self.assertRaisesRegex(CamResourceIntegrityError, "unsupported namespace: widgets"):
                refresh_manifest(manifest_path)


ZERO_SHA256 = "sha256:0x0000000000000000000000000000000000000000000000000000000000000000"


def numeric_product(expression: str) -> int:
    result = 1
    for term in expression.split("*"):
        result *= int(term.strip())

    return result


def sha256_hex(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
