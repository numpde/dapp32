from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from .cam_manifest_resources import CamManifestResourceValidator
from tools.cam_abi_plan import build_abi_plan_rows


class CamManifestResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_manifests_match_declared_abis_and_resource_inventory(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_declared_abi_usage),
            *self.validator.collect_manifest_failures(self.validator.validate_declared_route_continuations),
            *self.validator.collect_manifest_failures(self.validator.validate_resource_inventory),
            *self.validator.collect_manifest_failures(self.validator.validate_resource_integrity),
        ]

        if failures:
            self.fail("\n".join(failures))

    def test_namespaced_ui_inventory_rejects_missing_ui_or_legacy_screens(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)

            failures = self.validator.validate_resource_inventory(
                manifest_path,
                {
                    "namespaces": {
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                        },
                    }
                },
            )

            (manifest_path.parent / "ui.json").write_text("{}\n", encoding="utf-8")
            (manifest_path.parent / "screens").mkdir()

            legacy_failures = self.validator.validate_resource_inventory(
                manifest_path,
                {
                    "namespaces": {
                        "ui": {
                            "type": "ui",
                            "uri": "./ui.json",
                        },
                    }
                },
            )

        self.assertEqual(
            failures,
            [f"{manifest_path}: namespaces.ui.uri target does not exist: ./ui.json"],
        )
        self.assertEqual(
            legacy_failures,
            [f"{manifest_path}: namespaced CAM must not keep legacy screens/ resources"],
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

            self.assertEqual(
                [row.as_tsv() for row in build_abi_plan_rows(root)],
                [
                    "one\tone/src/AppUI.sol:AppUI\tAppUI.json\n",
                    "two\ttwo/src/AppUI.sol:AppUI\tAppUI.json\n",
                ],
            )

    def test_resource_integrity_checks_sha256_digests(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            (abi_dir / "UI.json").write_text("[]\n", encoding="utf-8")
            (manifest_path.parent / "ui.json").write_text('{"ui":"1.0.0","nodes":{}}\n', encoding="utf-8")

            failures = self.validator.validate_resource_integrity(
                manifest_path,
                {
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
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: namespaces.contracts.UI.integrity does not match ./abi/UI.json",
                f"{manifest_path}: namespaces.ui.integrity does not match ./ui.json",
            ],
        )

    def test_namespaced_route_calls_must_match_declared_abis(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            write_json(
                manifest_path.parent / "ui.json",
                {
                    "ui": "1.0.0",
                    "nodes": {
                        "app": {
                            "requires": ["view"],
                            "tag": "Screen",
                            "props": {
                                "title": "$view.missing",
                            },
                            "children": [],
                        },
                    },
                },
            )
            write_json(
                abi_dir / "UI.json",
                [
                    {
                        "type": "function",
                        "name": "viewEntry",
                        "stateMutability": "view",
                        "inputs": [{"name": "account", "type": "address"}],
                        "outputs": [{"name": "view", "type": "tuple", "components": []}],
                    },
                ],
            )
            write_json(
                abi_dir / "Manager.json",
                [
                    {
                        "type": "function",
                        "name": "readOnly",
                        "stateMutability": "view",
                        "inputs": [],
                        "outputs": [],
                    },
                ],
            )

            failures = self.validator.validate_declared_abi_usage(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                        },
                        "contracts.Manager": {
                            "type": "contract",
                            "abiURI": "./abi/Manager.json",
                        },
                    },
                    "routes": {
                        "entry": {
                            "kind": "read",
                            "call": {
                                "namespace": "contracts.UI",
                                "function": "viewEntry",
                                "args": {},
                            },
                            "then": {
                                "namespace": "ui",
                                "function": "app",
                                "args": {
                                    "view": "$outputs.0",
                                },
                            },
                        },
                        "badWrite": {
                            "kind": "write",
                            "call": {
                                "namespace": "contracts.Manager",
                                "function": "readOnly",
                                "args": {"extra": "x"},
                            },
                            "then": {
                                "namespace": "routes",
                                "function": "entry",
                                "args": {},
                            },
                        },
                        "missing": {
                            "kind": "write",
                            "call": {
                                "namespace": "contracts.Manager",
                                "function": "missing",
                                "args": {},
                            },
                            "then": {
                                "namespace": "routes",
                                "function": "entry",
                                "args": {},
                            },
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: missing arg account for UI.viewEntry at routes.entry.call",
                f"{manifest_path}: unexpected arg extra for Manager.readOnly at routes.badWrite.call",
                f"{manifest_path}: write route must target a payable or nonpayable ABI function "
                f"at routes.badWrite.call: Manager.readOnly",
                f"{manifest_path}: route call function is not present in Manager ABI at routes.missing.call: missing",
                f"{manifest_path}: UI expression references unknown contract view field "
                f"at {manifest_path.parent / 'ui.json'}.nodes.app.props.title: missing",
            ],
        )

    def test_route_continuation_output_references_must_match_declared_abi_outputs(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            abi_dir = manifest_path.parent / "abi"
            abi_dir.mkdir(parents=True)
            write_json(
                manifest_path.parent / "ui.json",
                {
                    "ui": "1.0.0",
                    "nodes": {
                        "app": {
                            "requires": ["view"],
                        },
                    },
                },
            )
            write_json(
                abi_dir / "UI.json",
                [
                    {
                        "type": "function",
                        "name": "viewEntry",
                        "stateMutability": "view",
                        "inputs": [],
                        "outputs": [{"name": "view", "type": "tuple", "components": []}],
                    },
                ],
            )

            failures = self.validator.validate_declared_abi_usage(
                manifest_path,
                {
                    "namespaces": {
                        "contracts.UI": {
                            "type": "contract",
                            "abiURI": "./abi/UI.json",
                        },
                    },
                    "routes": {
                        "entry": {
                            "kind": "read",
                            "call": {
                                "namespace": "contracts.UI",
                                "function": "viewEntry",
                                "args": {},
                            },
                            "then": {
                                "namespace": "ui",
                                "function": "app",
                                "args": {
                                    "view": "$outputs.1",
                                    "all": "$outputs",
                                },
                            },
                        },
                        "badCall": {
                            "kind": "read",
                            "call": {
                                "namespace": "contracts.UI",
                                "function": "viewEntry",
                                "args": {
                                    "view": "$outputs.0",
                                },
                            },
                            "then": {
                                "namespace": "ui",
                                "function": "app",
                                "args": {},
                            },
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: output expression references output 1, "
                f"but ABI declares 1 output(s) at routes.entry.then.args.view",
                f"{manifest_path}: output expression must select a numbered output at routes.entry.then.args.all: $outputs",
                f"{manifest_path}: unexpected arg view for UI.viewEntry at routes.badCall.call",
                f"{manifest_path}: output expression references output 0, "
                f"but ABI declares 0 output(s) at routes.badCall.call.args.view",
            ],
        )

    def test_route_continuations_must_match_declared_targets(self) -> None:
        with TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "cam" / "main.json"
            manifest_path.parent.mkdir(parents=True)
            write_json(
                manifest_path.parent / "ui.json",
                {
                    "ui": "1.0.0",
                    "nodes": {
                        "app": {
                            "requires": ["view"],
                        },
                    },
                },
            )

            failures = self.validator.validate_declared_route_continuations(
                manifest_path,
                {
                    "routes": {
                        "entry": {
                            "kind": "read",
                            "inputs": [],
                            "then": {
                                "namespace": "ui",
                                "function": "app",
                                "args": {},
                            },
                        },
                        "write": {
                            "kind": "write",
                            "inputs": ["serialNumber"],
                            "then": {
                                "namespace": "routes",
                                "function": "entry",
                                "args": {
                                    "extra": "$inputs.serialNumber",
                                },
                            },
                        },
                        "missingUi": {
                            "kind": "read",
                            "inputs": [],
                            "then": {
                                "namespace": "ui",
                                "function": "missing",
                                "args": {},
                            },
                        },
                        "missingRoute": {
                            "kind": "write",
                            "inputs": [],
                            "then": {
                                "namespace": "routes",
                                "function": "missing",
                                "args": {},
                            },
                        },
                    },
                },
            )

        self.assertEqual(
            failures,
            [
                f"{manifest_path}: missing continuation arg view for UI node app at routes.entry.then",
                f"{manifest_path}: unexpected continuation arg extra for route entry at routes.write.then",
                f"{manifest_path}: route continuation references unknown UI node at routes.missingUi.then: missing",
                f"{manifest_path}: route continuation references unknown route at routes.missingRoute.then: missing",
            ],
        )


def write_json(path: Path, document: object) -> None:
    path.write_text(f"{json.dumps(document, indent=2)}\n", encoding="utf-8")
