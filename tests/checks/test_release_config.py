from __future__ import annotations

import contextlib
import io
import json
import os
import pty
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import unquote

from tools import release_config
from .common import ROOT, compose_sequence_or_empty, rendered_compose_config
from .text.test_rendered_compose_posture import makefile_compose_unit


COMMIT = "0123456789abcdef0123456789abcdef01234567"
FIXTURE_KEY = "0x" + "11" * 32
FIXTURE_ADDRESS = "0x" + "22" * 20
FIXTURE_DEPLOYER_ADDRESS = "0x" + "ab" * 20
FIXTURE_RPC = "https://rpc.example.test/private-fixture-credential"
APPROVAL_IMAGE = "sha256:" + "aa" * 32
APPROVAL_SOURCE = "b" * 40


def configuration(app):
    values = {
        "chain": "84532", "uri": "https://cam.example.test/releases/main.json",
        "address": FIXTURE_ADDRESS, "addresses": FIXTURE_ADDRESS,
        "claim-period": "86400", "delay": "86400", "text": "Fixture collection",
        "path": "/tmp/new-release-output",
        "cam-hash": "auto",
        "optional-text": "https://metadata.example.test/tokens/",
    }
    settings = {name: values[kind] for name, _, kind in release_config.fields(app)}
    settings["EXPECTED_DEPLOYER_ADDRESS"] = FIXTURE_DEPLOYER_ADDRESS
    return {
        "schemaVersion": 3, "app": app, "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC,
        "approvalImageId": APPROVAL_IMAGE,
        "deployerPrivateKey": FIXTURE_KEY, "confirmDeploy": True,
        "settings": settings,
    }


def unpack(app, source_commit, mode, source, output):
    """Supply the ordinary phase's resolved output; legacy fixtures may name it explicitly."""
    config = json.loads(source.read_text())
    # silent-defaults: allow-default -- Fixtures without a legacy saved destination receive the same instance-allocated output port.
    allocated = config.get("settings", {}).get("OUTPUT_DIR", "/tmp/new-release-output")
    with patch.dict(release_config.os.environ, {"RELEASE_CONFIG_OUTPUT_DIR": allocated}):
        release_config.unpack(app, source_commit, mode, source, output)


def complete_setup(app, source_commit, output):
    """Run both offline phases with the fixed RPC reply supplied by this fixture."""
    release_config.prepare_network(app, source_commit, output)
    if (output / "setup-network").read_text().strip() == "public":
        release_config.write_private(output / "chain-id", b"84532\n")
    release_config.setup(app, source_commit, output)


class ReleaseConfigTest(unittest.TestCase):
    def test_configuration_objects_are_admitted_before_credential_reference_access(self):
        for value in (None, [], ["credentialConfig"], "credentialConfig", 42):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                source = Path(directory) / "config.json"
                source.write_text(json.dumps(value))
                with self.assertRaisesRegex(ValueError, "configuration must be a JSON object"):
                    release_config.read_configuration(source, credentials=Path(directory) / "not-mounted.json")

    def test_tool_preparation_cannot_change_the_defaults_captured_for_an_operation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "config.json"
            original = configuration("escrow")
            source.write_text(json.dumps(original))
            changed = {**original, "settings": {**original["settings"], "EXPECTED_CHAIN_ID": "43113"}}
            (root / "changed.json").write_text(json.dumps(changed))
            (root / "stage").mkdir()
            script = r'''
source tools/release-config.sh
source_commit="$SOURCE"
release_config_dir="$CASE_ROOT/stage"
require_release_config() { [[ -f "$1" ]]; }
release_config_prepare_approval_images() {
  cp -- "$CASE_ROOT/changed.json" "$CASE_ROOT/config.json"
  printf '%s\n' "$1" > "$release_config_dir/approval-image"
}
compose_release_config() {
  if [[ " $* " == *' release-config credential-source '* ]]; then
    printf '%s\n' "$CONFIG" > "$release_config_dir/credential-source"
  elif [[ " $* " == *' release-config approval-pin '* ]]; then
    printf '%s\n' "$IMAGE" > "$release_config_dir/approval-pin"
  else
    RELEASE_CREDENTIAL_CONFIG="$release_config_credentials" "$PYTHON" -I -B -c '
import sys
from pathlib import Path
sys.path.insert(0, "tools")
from release_config import retain_configuration
retain_configuration(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]))
' "$release_config_input" "$source_commit" "$release_config_dir"
  fi
}
release_config_capture "$CASE_ROOT/config.json" "$CASE_ROOT/captured.json" escrow
'''
            result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", script], cwd=ROOT, capture_output=True, text=True,
                                    env={**os.environ, "CASE_ROOT": str(root), "SOURCE": COMMIT, "IMAGE": APPROVAL_IMAGE, "PYTHON": sys.executable}, timeout=10)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            retained = json.loads((root / "captured.json").read_text())
            self.assertEqual("84532", retained["settings"]["EXPECTED_CHAIN_ID"])
            self.assertEqual(str(source), retained["credentialConfig"])
            self.assertEqual(changed, json.loads(source.read_text()))
            self.assertNotIn(FIXTURE_KEY, (root / "captured.json").read_text())

    def test_operation_inputs_keep_choices_but_read_current_credentials_without_copying_secrets(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                original = configuration(app)
                source = root / "config.json"
                source.write_text(json.dumps(original))
                retained = root / "retained"
                retained.mkdir()
                with patch.dict(os.environ, {"RELEASE_CREDENTIAL_CONFIG": str(source)}):
                    release_config.retain_configuration(source, "f" * 40, retained)
                snapshot = retained / "operation-inputs.json"
                saved = json.loads(snapshot.read_text())
                self.assertNotIn(FIXTURE_KEY, snapshot.read_text())
                self.assertNotIn(FIXTURE_RPC, snapshot.read_text())
                self.assertNotIn("OUTPUT_DIR", saved["settings"])
                self.assertEqual(str(source), saved["credentialConfig"])
                changed = {**original, "sourceCommit": "b" * 40, "approvalImageId": "sha256:" + "bb" * 32,
                           "rpcUrl": "https://replacement.example.test", "deployerPrivateKey": "0x" + "33" * 32,
                           "settings": {**original["settings"], "EXPECTED_CHAIN_ID": "43113"}}
                source.write_text(json.dumps(changed))
                joined = release_config.read_configuration(snapshot, credentials=source)
                self.assertEqual("f" * 40, joined["sourceCommit"])
                self.assertEqual(APPROVAL_IMAGE, joined["approvalImageId"])
                self.assertEqual("84532", joined["settings"]["EXPECTED_CHAIN_ID"])
                self.assertEqual(changed["rpcUrl"], joined["rpcUrl"])
                self.assertEqual(changed["deployerPrivateKey"], joined["deployerPrivateKey"])
                self.assertEqual(changed, json.loads(source.read_text()))
                again = root / "again"
                again.mkdir()
                with patch.dict(os.environ, {"RELEASE_CREDENTIAL_CONFIG": str(source)}):
                    release_config.retain_configuration(snapshot, "c" * 40, again)
                self.assertEqual(saved, json.loads((again / "operation-inputs.json").read_text()))

    def test_hosting_uri_is_a_late_operation_input_without_mutating_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "config.json"
            config = configuration("escrow")
            config["settings"].pop("CAM_URI")
            original = json.dumps(config)
            source.write_text(original)
            with patch.object(release_config.sys.stdin, "isatty", return_value=True), patch.object(release_config, "input", return_value="https://hosted.example.test/main.json", create=True):
                release_config.publication_uri(source, root)
            with patch.dict(os.environ, {"RELEASE_CREDENTIAL_CONFIG": str(source)}):
                release_config.retain_configuration(source, COMMIT, root)
            saved = json.loads((root / "operation-inputs.json").read_text())
            self.assertEqual("https://hosted.example.test/main.json", saved["settings"]["CAM_URI"])
            self.assertEqual(original, source.read_text())

    def test_cam_loader_clears_ambient_values_and_admits_override_before_an_interactive_update(self):
        script = r'''
source tools/release-config.sh
source_commit=current
CONFIG="$CASE_ROOT/config.json"
require_release_config() { [[ -f "$1" ]]; }
release_config_stage() { release_config_dir="$CASE_ROOT/stage"; mkdir "$release_config_dir"; }
release_config_prepare_approval_images() { printf '%s\n' "sha256:$(printf 'a%.0s' {1..64})" > "$release_config_dir/approval-image"; }
validate_new_release_output() {
  [[ "$1" == "$CASE_ROOT/selected-output" && "$2" == CAM_RELEASE_OUTPUT_DIR ]]
  printf checked > "$CASE_ROOT/output-checked"
}
docker() {
  [[ "$1 $2 $3" == 'image inspect --format' ]]
  printf image-checked > "$CASE_ROOT/image-checked"
  printf '%s\n' "$5"
}
compose_release_config() {
  if [[ " $* " == *' release-config credential-source '* ]]; then
    printf '%s\n' "$CONFIG" > "$release_config_dir/credential-source"
    if [[ "$MODE" == retained ]]; then printf saved-source > "$release_config_dir/retained-source"; fi
    return
  fi
  if [[ " $* " == *' release-config retain '* ]]; then
    if [[ "$MODE" == cam-bundle ]]; then [[ "${@: -1}" == authored ]]; fi
    printf '{}\n' > "$release_config_dir/operation-inputs.json"; return
  fi
  if [[ " $* " == *' release-config publication-uri '* ]]; then return; fi
  if [[ " $* " == *' release-config approval-pin '* ]]; then
    printf '%s\n' "sha256:$(printf 'a%.0s' {1..64})" > "$release_config_dir/approval-pin"
    return
  fi
  printf '%s\n' "$*" >> "$CASE_ROOT/events"
  if [[ " $* " == *' release-config update-cam '* ]]; then
    printf '{"settings":{"OUTPUT_DIR":"/tmp/saved-cam"}}' > "$release_config_dir/release.json"
    return
  fi
  if [[ ( "$MODE" == update || "$MODE" == noninteractive || "$MODE" == retained ) && ! -f "$release_config_dir/release.json" ]]; then return 3; fi
  printf 'rpc fixture\n' > "$release_config_dir/rpc-url"
  printf 'CAM_RELEASE_APP=escrow\0' > "$release_config_dir/inputs"
  if [[ "$MODE" != cam-artifact ]]; then
    selected_source=current
    if [[ "$MODE" == cam-bundle ]]; then selected_source=authored; fi
    printf 'CAM_RELEASE_SOURCE_COMMIT=%s\0CAM_RELEASE_EXPECTED_CHAIN_ID=84532\0CAM_RELEASE_OUTPUT_DIR=/tmp/saved-cam\0' "$selected_source" >> "$release_config_dir/inputs"
  fi
  if [[ "$MODE" == cam-publish || "$MODE" == update ]]; then
    printf 'CAM_RELEASE_SIGNER_ADDRESS=selected-signer\0CAM_RELEASE_URI=selected-uri\0CAM_RELEASE_INTENDED_OWNER=selected-owner\0RELEASE_APPROVAL_IMAGE=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0' >> "$release_config_dir/inputs"
    printf 'key fixture\n' > "$release_config_dir/deployer-key"
  fi
}
CAM_RELEASE_SIGNER_ADDRESS=stale
CAM_RELEASE_URI=stale
CAM_RELEASE_INTENDED_OWNER=stale
CAM_RELEASE_OUTPUT_DIR=stale
RELEASE_APPROVAL_IMAGE=stale
DEPLOYER_PRIVATE_KEY_FILE=stale
operation="$MODE"
if [[ "$MODE" == update || "$MODE" == noninteractive || "$MODE" == retained ]]; then operation=cam-publish; fi
OUTPUT_DIR="$CASE_ROOT/selected-output"
load_release_config escrow "$operation"
[[ "$CAM_RELEASE_APP" == escrow && "$RPC_URL_FILE" == "$release_config_dir/rpc-url" ]]
if [[ "$MODE" == cam-publish || "$MODE" == update ]]; then
  [[ "$CAM_RELEASE_SIGNER_ADDRESS" == selected-signer && "$CAM_RELEASE_URI" == selected-uri && "$CAM_RELEASE_INTENDED_OWNER" == selected-owner ]]
  [[ "$DEPLOYER_PRIVATE_KEY_FILE" == "$release_config_dir/deployer-key" ]]
else
  [[ ! -v CAM_RELEASE_SIGNER_ADDRESS && ! -v CAM_RELEASE_URI && ! -v CAM_RELEASE_INTENDED_OWNER ]]
  [[ ! -v RELEASE_APPROVAL_IMAGE && ! -v DEPLOYER_PRIVATE_KEY_FILE ]]
fi
if [[ "$MODE" == cam-artifact ]]; then [[ ! -v CAM_RELEASE_OUTPUT_DIR ]];
else [[ "$CAM_RELEASE_OUTPUT_DIR" == "$CASE_ROOT/selected-output" ]]; fi
printf continued > "$CASE_ROOT/continued"
'''
        for mode in ("cam-bundle", "cam-artifact", "cam-publish", "update", "noninteractive", "retained"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = root / "config.json"
                config.write_text("original")
                master, slave = pty.openpty()
                try:
                    result = subprocess.run(
                        ["bash", "-eu", "-o", "pipefail", "-c", script], cwd=ROOT,
                        env={**os.environ, "CASE_ROOT": str(root), "MODE": mode},
                        stdin=slave if mode == "update" else subprocess.DEVNULL,
                        stdout=slave, stderr=subprocess.PIPE, text=True, timeout=10, check=False,
                    )
                finally:
                    os.close(master)
                    os.close(slave)
                self.assertEqual(3 if mode == "noninteractive" else 2 if mode == "retained" else 0, result.returncode, result.stderr)
                self.assertEqual(mode not in ("noninteractive", "retained"), (root / "continued").exists())
                self.assertEqual(mode in ("cam-publish", "update"), (root / "image-checked").exists())
                self.assertEqual(mode == "update", (root / "output-checked").exists())
                if mode == "noninteractive":
                    self.assertIn("Run this command interactively", result.stderr)
                    self.assertIn("saved configuration will not change", result.stderr)
                if mode == "update":
                    self.assertIn(" release-config update-cam ", (root / "events").read_text())
                self.assertEqual("original", config.read_text())

    def test_cam_bundle_preparation_uses_only_readonly_settings_before_a_uri_exists(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = {"schemaVersion": 3, "app": app, "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC,
                          "settings": {"EXPECTED_CHAIN_ID": "84532", "OUTPUT_DIR": "/tmp/cam-bundle",
                                       "CAM_URI": None, "INTENDED_CAM_ROOT_OWNER": None, "REGISTRARS": None},
                          "approvalImageId": None, "deployerPrivateKey": None, "confirmDeploy": False}
                source = root / "config.json"
                source.write_text(json.dumps(config))
                before = source.read_bytes()
                output = root / "stage"
                output.mkdir()
                unpack(app, "f" * 40, "cam-bundle", source, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual({"CAM_RELEASE_APP": app, "CAM_RELEASE_SOURCE_COMMIT": COMMIT,
                                  "CAM_RELEASE_EXPECTED_CHAIN_ID": "84532", "CAM_RELEASE_OUTPUT_DIR": "/tmp/cam-bundle",
                                  "RELEASE_REHEARSAL": "0"}, inputs)
                self.assertEqual({"inputs", "rpc-url"}, {path.name for path in output.iterdir()})
                self.assertEqual(FIXTURE_RPC + "\n", (output / "rpc-url").read_text())
                self.assertEqual(before, source.read_bytes())

    def test_cam_bundle_requires_identity_rpc_chain_and_output_before_writes(self):
        valid = {"schemaVersion": 3, "app": "escrow", "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC,
                 "settings": {"EXPECTED_CHAIN_ID": "84532", "OUTPUT_DIR": "/tmp/cam-bundle"}}
        invalid = [dict(valid, app="bike-nft"), dict(valid, sourceCommit="main"), dict(valid, rpcUrl="http://untrusted"),
                   dict(valid, settings={"EXPECTED_CHAIN_ID": "84532"}),
                   dict(valid, settings={"EXPECTED_CHAIN_ID": "31337", "OUTPUT_DIR": "/tmp/cam-bundle"}),
                   dict(valid, settings={"EXPECTED_CHAIN_ID": "84532", "OUTPUT_DIR": "relative"}),
                   dict(valid, localNetwork="fixture-network", rpcUrl=release_config.LOCAL_RPC_URL)]
        for config in invalid:
            with self.subTest(config=config), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps(config))
                output = root / "stage"
                output.mkdir()
                with self.assertRaises(ValueError):
                    release_config.unpack("escrow", COMMIT, "cam-bundle", source, output)
                self.assertEqual([], list(output.iterdir()))

    def test_cam_publication_stages_only_root_inputs_and_optional_owner_nomination(self):
        for app in release_config.APP_FIELDS:
            for owner in (None, FIXTURE_ADDRESS):
                with self.subTest(app=app, owner=owner), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    config = configuration(app)
                    config["settings"] = {"EXPECTED_CHAIN_ID": "84532", "EXPECTED_DEPLOYER_ADDRESS": FIXTURE_DEPLOYER_ADDRESS,
                                          "OUTPUT_DIR": "/tmp/cam-publication", "CAM_URI": "ipfs://fixture/main.json"}
                    # Retired business and hash settings are irrelevant to root publication.
                    config["settings"].update({name: None for name, _, _ in release_config.APP_FIELDS[app]})
                    config["settings"]["CAM_HASH"] = "auto"
                    if owner is not None:
                        config["settings"]["INTENDED_CAM_ROOT_OWNER"] = owner
                    source = root / "config.json"
                    source.write_text(json.dumps(config))
                    before = source.read_bytes()
                    output = root / "stage"
                    output.mkdir()
                    unpack(app, COMMIT, "cam-publish", source, output)
                    inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                    self.assertEqual({"CAM_RELEASE_APP": app, "CAM_RELEASE_SOURCE_COMMIT": COMMIT,
                                      "CAM_RELEASE_EXPECTED_CHAIN_ID": "84532", "CAM_RELEASE_SIGNER_ADDRESS": FIXTURE_DEPLOYER_ADDRESS,
                                      "CAM_RELEASE_OUTPUT_DIR": "/tmp/cam-publication", "CAM_RELEASE_URI": "ipfs://fixture/main.json", "CAM_RELEASE_HASH": "auto",
                                      "CAM_RELEASE_INTENDED_OWNER": owner or "0x" + "00" * 20,
                                      "RELEASE_APPROVAL_IMAGE": APPROVAL_IMAGE, "RELEASE_REHEARSAL": "0"}, inputs)
                    self.assertEqual({"inputs", "rpc-url", "deployer-key"}, {path.name for path in output.iterdir()})
                    self.assertEqual(FIXTURE_KEY + "\n", (output / "deployer-key").read_text())
                    self.assertEqual(before, source.read_bytes())

    def test_cam_publication_preserves_explicit_unverified_hash(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration("escrow")
            config["settings"]["CAM_HASH"] = "0x" + "00" * 32
            source = root / "config.json"
            source.write_text(json.dumps(config))
            output = root / "stage"
            output.mkdir()
            unpack("escrow", COMMIT, "cam-publish", source, output)
            fields = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
            self.assertEqual(config["settings"]["CAM_HASH"], fields["CAM_RELEASE_HASH"])

    def test_cam_paid_publication_retains_strict_source_and_supplied_owner_policy(self):
        for changes, source_commit, error_type in (
            ({}, "f" * 40, release_config.SourceCommitMismatch),
            ({"INTENDED_CAM_ROOT_OWNER": "0x" + "00" * 20}, COMMIT, ValueError),
            ({"INTENDED_CAM_ROOT_OWNER": None}, COMMIT, ValueError),
            ({"CAM_URI": "http://untrusted/main.json"}, COMMIT, ValueError),
        ):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = configuration("escrow")
                config["settings"].update(changes)
                source = root / "config.json"
                source.write_text(json.dumps(config))
                output = root / "stage"
                output.mkdir()
                with self.assertRaises(error_type):
                    unpack("escrow", source_commit, "cam-publish", source, output)
                self.assertEqual([], list(output.iterdir()))

    def test_local_cam_publication_accepts_an_independent_signer_but_keeps_fixture_transport(self):
        for app in release_config.APP_FIELDS:
            config = configuration(app)
            config["localNetwork"] = "fixture-private-network"
            config["rpcUrl"] = release_config.LOCAL_RPC_URL
            config["settings"] = {"EXPECTED_CHAIN_ID": "31338", "EXPECTED_DEPLOYER_ADDRESS": FIXTURE_DEPLOYER_ADDRESS,
                                  "OUTPUT_DIR": "/tmp/cam-publication", "CAM_URI": f"http://release-cam:8080/{app}/main.json"}
            release_config.validate(config, app, COMMIT, purpose="cam")
            for name, value in (("EXPECTED_CHAIN_ID", "84532"), ("CAM_URI", "http://release-cam:8080/other/main.json")):
                changed = dict(config, settings=dict(config["settings"], **{name: value}))
                with self.subTest(app=app, name=name), self.assertRaises(ValueError):
                    release_config.validate(changed, app, COMMIT, purpose="cam")

    def test_cam_artifact_and_plan_source_need_no_retired_signing_settings(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps({"schemaVersion": 3, "app": app, "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC}))
                output = root / "stage"
                output.mkdir()
                unpack(app, "f" * 40, "cam-artifact", source, output)
                self.assertEqual(f"CAM_RELEASE_APP={app}\0RELEASE_REHEARSAL=0\0", (output / "inputs").read_text())
                self.assertEqual({"inputs", "rpc-url"}, {path.name for path in output.iterdir()})
                plan = root / "plan.json"
                for saved in ({"schema": "cam.ui-release-plan.v1", "app": app, "sourceCommit": COMMIT},
                              {"schema": "cam.publication-plan.v1", "app": app, "sourceCommit": "main"},
                              {"schema": "cam.publication-plan.v1", "app": "other", "sourceCommit": COMMIT}):
                    plan.write_text(json.dumps(saved))
                    with self.assertRaises(ValueError):
                        release_config.independent_plan_source(app, plan, output, "cam")
                    self.assertFalse((output / "cam-source").exists())
                plan.write_text(json.dumps({"schema": "cam.publication-plan.v1", "app": app, "sourceCommit": "b" * 40}))
                release_config.independent_plan_source(app, plan, output, "cam")
                self.assertEqual("b" * 40 + "\n", (output / "cam-source").read_text())

    def test_cam_source_update_preserves_configured_output_and_unrelated_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = configuration("bike-nft")
            original["settings"].update(REGISTRARS=None, CAM_HASH="0x" + "00" * 32)
            source = root / "config.json"
            source.write_text(json.dumps(original))
            before = source.read_bytes()
            output = root / "stage"
            output.mkdir()
            (output / "approval-image").write_text(f"{APPROVAL_IMAGE}\n")
            with patch.object(release_config, "input", return_value="update", create=True), contextlib.redirect_stdout(io.StringIO()):
                release_config.update_source("bike-nft", "f" * 40, source, output, purpose="cam")
            self.assertEqual(dict(original, sourceCommit="f" * 40), json.loads((output / "release.json").read_text()))
            self.assertEqual(before, source.read_bytes())

    def test_ui_artifact_completion_uses_recorded_source_without_staging_any_signing_inputs(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps({"schemaVersion": 3, "app": app, "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC}))
                output = root / "stage"
                output.mkdir()
                unpack(app, "f" * 40, "ui-artifact", source, output)
                self.assertEqual({"inputs", "rpc-url"}, {path.name for path in output.iterdir()})
                plan = root / "plan.json"
                plan.write_text(json.dumps({"schema": "cam.ui-release-plan.v1", "app": app, "sourceCommit": "b" * 40}))
                release_config.independent_plan_source(app, plan, output, "ui")
                self.assertEqual("b" * 40, (output / "ui-source").read_text().strip())

    def test_business_deployment_translates_only_its_own_settings_without_cam_or_ui(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = configuration(app)
                names = {"EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS", "OUTPUT_DIR"}
                names |= {name for name, _, _ in release_config.APP_FIELDS[app]}
                config["settings"] = {name: value for name, value in config["settings"].items() if name in names}
                source = root / "config.json"
                source.write_text(json.dumps(config))
                output = root / "stage"
                output.mkdir()
                with patch.dict("os.environ", {"RELEASE_CONFIG_FILE": str(source)}):
                    unpack(app, COMMIT, "contracts-deploy", source, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual(app, inputs["CONTRACT_RELEASE_APP"])
                self.assertEqual(COMMIT, inputs["CONTRACT_RELEASE_SOURCE_COMMIT"])
                settings = json.loads(inputs["CONTRACT_RELEASE_SETTINGS_JSON"])
                self.assertFalse(any("cam" in name.lower() or "ui" in name.lower() for name in settings))
                if app == "escrow":
                    self.assertEqual({}, settings)
                elif app == "pay-to-play":
                    self.assertEqual(86400, settings["nullClaimPeriod"])
                    self.assertEqual(FIXTURE_ADDRESS, settings["intendedPaymentAdmin"])
                else:
                    self.assertEqual(config["settings"]["BASE_TOKEN_URI"], settings["baseTokenURI"])
                    self.assertEqual(config["settings"]["COLLECTION_URI"], settings["collectionURI"])
                    self.assertEqual([FIXTURE_ADDRESS], settings["registrars"])
                    self.assertEqual(86400, settings["componentsAdminDelay"])
                self.assertEqual(FIXTURE_KEY + "\n", (output / "deployer-key").read_text())
                self.assertEqual(config, json.loads(source.read_text()))

    def test_ui_deployment_uses_only_its_own_inputs_and_preserves_business_records(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = configuration(app)
                original_output = "/tmp/new-release-output"
                config["settings"] = {name: config["settings"][name] for name in
                                      ("EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS")}
                source = root / "config.json"
                source.write_text(json.dumps(config))
                output = root / "stage"
                output.mkdir()
                with patch.dict("os.environ", {"RELEASE_CONFIG_FILE": str(source)}):
                    unpack(app, COMMIT, "ui-deploy", source, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual(app, inputs["UI_RELEASE_APP"])
                self.assertEqual(COMMIT, inputs["UI_RELEASE_SOURCE_COMMIT"])
                self.assertEqual(FIXTURE_DEPLOYER_ADDRESS, inputs["UI_RELEASE_CREATOR_ADDRESS"])
                self.assertEqual(original_output, inputs["UI_RELEASE_OUTPUT_DIR"])
                self.assertEqual(FIXTURE_KEY + "\n", (output / "deployer-key").read_text())
                self.assertEqual(config, json.loads(source.read_text()))
                self.assertFalse(any("CAM_" in name or "ADMIN" in name for name in inputs))

    def test_ui_deployment_ignores_unrelated_full_release_values(self):
        config = configuration("bike-nft")
        config["settings"].update(CAM_URI=None, INTENDED_CAM_ROOT_OWNER=None, REGISTRARS=None)
        release_config.validate(config, "bike-nft", COMMIT, purpose="ui")
        with self.assertRaises(ValueError):
            release_config.validate(config, "bike-nft", COMMIT, purpose="deployment")

    def test_ui_deployment_local_creator_can_differ_from_the_business_fixture_creator(self):
        config = configuration("pay-to-play")
        config["localNetwork"] = "fixture-private-network"
        config["rpcUrl"] = release_config.LOCAL_RPC_URL
        config["settings"] = {"EXPECTED_CHAIN_ID": "31338", "EXPECTED_DEPLOYER_ADDRESS": FIXTURE_DEPLOYER_ADDRESS,
                              "OUTPUT_DIR": "/tmp/new-ui-deployment"}
        release_config.validate(config, "pay-to-play", COMMIT, purpose="ui")

    def test_business_artifact_completion_uses_its_saved_plan_without_signing_settings(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps({"schemaVersion": 3, "app": app, "sourceCommit": COMMIT,
                                              "rpcUrl": FIXTURE_RPC}))
                output = root / "stage"
                output.mkdir()
                unpack(app, "f" * 40, "contracts-artifact", source, output)
                self.assertEqual(f"CONTRACT_RELEASE_APP={app}\0RELEASE_REHEARSAL=0\0", (output / "inputs").read_text())
                self.assertEqual({"inputs", "rpc-url"}, {path.name for path in output.iterdir()})
                plan = root / "plan.json"
                for saved in ({"schema": "cam.ui-release-plan.v1", "app": app, "sourceCommit": COMMIT},
                              {"schema": "cam.contract-release-plan.v1", "app": "other", "sourceCommit": COMMIT}):
                    plan.write_text(json.dumps(saved))
                    with self.assertRaises(ValueError):
                        release_config.independent_plan_source(app, plan, output, "contract")
                    self.assertFalse((output / "contract-source").exists())
                plan.write_text(json.dumps({"schema": "cam.contract-release-plan.v1", "app": app,
                                            "sourceCommit": "b" * 40}))
                release_config.independent_plan_source(app, plan, output, "contract")
                self.assertEqual("b" * 40 + "\n", (output / "contract-source").read_text())

    def test_update_replaces_only_a_missing_approval_image_and_preserves_the_local_fixture(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            original = configuration("escrow")
            original.update(localNetwork="fixture-internal", rpcUrl=release_config.LOCAL_RPC_URL,
                            deployerPrivateKey=release_config.LOCAL_DEPLOYER_KEY, approvalImageId="sha256:" + "b" * 64)
            original["settings"].update(EXPECTED_CHAIN_ID="31338", EXPECTED_DEPLOYER_ADDRESS=release_config.LOCAL_DEPLOYER_ADDRESS)
            source = root / "config.json"
            source.write_text(json.dumps(original))
            output = root / "stage"
            output.mkdir()
            (output / "approval-image").write_text(f"{APPROVAL_IMAGE}\n")
            with patch.object(release_config, "input", side_effect=["update"], create=True), contextlib.redirect_stdout(io.StringIO()):
                release_config.update_source("escrow", "f" * 40, source, output, purpose="deployment")
            updated = json.loads((output / "release.json").read_text())
            self.assertEqual(APPROVAL_IMAGE, updated["approvalImageId"])
            original["sourceCommit"] = updated["sourceCommit"]
            original["approvalImageId"] = updated["approvalImageId"]
            self.assertEqual(original, updated)
            self.assertNotIn("OUTPUT_DIR", updated["settings"])

    def test_update_rejects_invalid_configs_before_prompting_or_writing(self):
        for changes in ({"schemaVersion": 1}, {"sourceCommit": "main"}, {"app": "bike-nft"}, {"confirmDeploy": False}):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps(dict(configuration("escrow"), **changes)))
                output = root / "stage"
                output.mkdir()
                with patch.object(release_config, "input", create=True) as prompt:
                    with self.assertRaises(ValueError):
                        release_config.update_source("escrow", "f" * 40, source, output, purpose="deployment")
                prompt.assert_not_called()
                self.assertEqual([], list(output.iterdir()))

    def test_source_update_preserves_inputs_and_requires_explicit_confirmation_for_all_apps(self):
        current = "f" * 40
        for app in release_config.APP_FIELDS:
            for decision in ("update", "", "cancel"):
                with self.subTest(app=app, decision=decision), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    original = configuration(app)
                    original["settings"]["CAM_HASH"] = "0x" + "0" * 64
                    source = root / "config.json"
                    source.write_text(json.dumps(original))
                    before = source.read_bytes()
                    output = root / "stage"
                    output.mkdir()
                    (output / "approval-image").write_text(f"{APPROVAL_IMAGE}\n")
                    transcript = io.StringIO()
                    with patch.object(release_config, "input", side_effect=[decision], create=True), contextlib.redirect_stdout(transcript):
                        if decision == "update":
                            release_config.update_source(app, current, source, output, purpose="deployment")
                            updated = json.loads((output / "release.json").read_text())
                            expected = dict(original, sourceCommit=current)
                            self.assertEqual(expected, updated)
                        else:
                            with self.assertRaisesRegex(ValueError, "cancelled"):
                                release_config.update_source(app, current, source, output, purpose="deployment")
                            self.assertFalse((output / "release.json").exists())
                    self.assertEqual(before, source.read_bytes())
                    for secret in (FIXTURE_RPC, FIXTURE_KEY):
                        self.assertNotIn(secret, transcript.getvalue())
                    self.assertIn(COMMIT, transcript.getvalue())
                    self.assertIn(current, transcript.getvalue())

    def test_endpoint_selection_collects_no_signing_key_and_detected_chain_is_confirmed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(release_config, "input", return_value="public", create=True), patch.object(release_config.getpass, "getpass", return_value=FIXTURE_RPC) as hidden, contextlib.redirect_stdout(io.StringIO()):
                release_config.prepare_network("escrow", COMMIT, root)
            self.assertEqual(1, hidden.call_count)
            self.assertFalse((root / "release.json").exists())
            release_config.write_private(root / "chain-id", b"43113\n")
            expected = configuration("escrow")
            expected["settings"]["EXPECTED_CHAIN_ID"] = "43113"
            answers = iter(["", *[value for name, value in expected["settings"].items() if name != "EXPECTED_CHAIN_ID"], "save"])
            prompts = []
            def respond(prompt):
                prompts.append(prompt)
                return next(answers)
            with patch.object(release_config, "input", side_effect=respond, create=True), patch.object(release_config.getpass, "getpass", return_value=FIXTURE_KEY) as key_input, contextlib.redirect_stdout(io.StringIO()):
                release_config.setup("escrow", COMMIT, root)
            self.assertEqual(expected, json.loads((root / "release.json").read_text()))
            self.assertIn("43113", prompts[0])
            self.assertEqual(1, key_input.call_count)

    def test_a_different_chain_cannot_replace_the_detected_chain_or_request_a_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(release_config, "input", return_value="public", create=True), patch.object(release_config.getpass, "getpass", return_value=FIXTURE_RPC), contextlib.redirect_stdout(io.StringIO()):
                release_config.prepare_network("escrow", COMMIT, root)
            release_config.write_private(root / "chain-id", b"43113\n")
            with patch.object(release_config, "input", return_value="1", create=True), patch.object(release_config.getpass, "getpass") as key_input, contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(ValueError, "RPC"):
                    release_config.setup("escrow", COMMIT, root)
            key_input.assert_not_called()
            self.assertFalse((root / "release.json").exists())

    def test_public_admin_delays_offer_three_days_without_overriding_a_custom_value(self):
        expected = configuration("bike-nft")
        expected["settings"]["COMPONENTS_ADMIN_DELAY"] = "259200"
        expected["settings"]["MANAGER_ADMIN_DELAY"] = "7200"
        entered = dict(expected["settings"])
        entered["COMPONENTS_ADMIN_DELAY"] = ""
        answers = iter(["public", *entered.values(), "save"])
        prompts = []
        def respond(prompt):
            prompts.append(prompt)
            return next(answers)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            transcript = io.StringIO()
            with patch.object(release_config, "input", side_effect=respond, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                complete_setup("bike-nft", COMMIT, root)
            self.assertEqual(expected, json.loads((root / "release.json").read_text()))
            delays = [prompt for prompt in prompts if "administrator transfer delay" in prompt]
            self.assertEqual(2, len(delays))
            self.assertTrue(all("[259200]" in prompt for prompt in delays))
            self.assertIn("3 days", transcript.getvalue())

    def setUp(self):
        self.setup_environment = patch.dict(release_config.os.environ, {"RELEASE_CONFIG_FILE": "/tmp/fixture-release.json"})
        self.setup_environment.start()
        self.addCleanup(self.setup_environment.stop)
        self.image_choice = patch.object(release_config, "prepared_approval_image", return_value=APPROVAL_IMAGE, create=True)
        self.image_choice.start()
        self.addCleanup(self.image_choice.stop)

    def test_setup_selects_a_checked_image_and_deploy_unpack_uses_the_saved_id_for_every_app(self):
        self.image_choice.stop()
        other_image = "sha256:" + "cc" * 32
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "approval-image").write_text(f"{APPROVAL_IMAGE}\n")
                expected = configuration(app)
                answers = ["public", *expected["settings"].values(), "save"]
                transcript = io.StringIO()
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                    complete_setup(app, COMMIT, root)
                saved = root / "release.json"
                self.assertEqual(expected, json.loads(saved.read_text()))
                self.assertIn(APPROVAL_IMAGE, transcript.getvalue())
                self.assertNotIn("Approval image number", transcript.getvalue())
                output = root / "unpacked"
                output.mkdir()
                with patch.dict(release_config.os.environ, {"RELEASE_APPROVAL_IMAGE": other_image}):
                    unpack(app, COMMIT, "deploy", saved, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual(APPROVAL_IMAGE, inputs["RELEASE_APPROVAL_IMAGE"])


    def test_authority_help_at_address_choices_and_review_preserves_each_apps_settings(self):
        heading = "Changing addresses after deployment:"
        deployer_label = next(label for name, label, _ in release_config.COMMON_FIELDS if name == "EXPECTED_DEPLOYER_ADDRESS")
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                expected = configuration(app)
                answers = iter(["public", *expected["settings"].values(), "save"])
                transcript = io.StringIO()
                surfaces = {}
                def respond(prompt):
                    if prompt.startswith(deployer_label):
                        surfaces["choice"] = transcript.getvalue()
                    elif prompt.startswith("Save this release configuration"):
                        surfaces["review"] = transcript.getvalue()
                    return next(answers)
                root = Path(temporary)
                with patch.object(release_config, "input", side_effect=respond, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                    complete_setup(app, COMMIT, root)
                self.assertEqual(expected, json.loads((root / "release.json").read_text()))
                self.assertEqual(1, surfaces["choice"].count(heading))
                self.assertEqual(2, surfaces["review"].count(heading))
                for surface in surfaces.values():
                    help_text = surface.rsplit(heading, 1)[1]
                    self.assertIn("EXPECTED_DEPLOYER_ADDRESS:", help_text)
                    self.assertIn("INTENDED_CAM_ROOT_OWNER:", help_text)
                    self.assertEqual(app == "pay-to-play", "INTENDED_PAYMENT_ADMIN:" in help_text)
                    for group in ("INTENDED_COMPONENTS_ADMIN / INTENDED_MANAGER_ADMIN:", "COMPONENTS_PAUSER / COMPONENTS_CONFIGURER:", "MANAGER_PAUSER / MANAGER_CONFIGURER / REGISTRARS:"):
                        self.assertEqual(app == "bike-nft", group in help_text)

    def test_bike_selected_deployer_authorities_survive_setup_and_unpack(self):
        roles = ("INTENDED_CAM_ROOT_OWNER", "INTENDED_COMPONENTS_ADMIN", "COMPONENTS_PAUSER", "COMPONENTS_CONFIGURER", "INTENDED_MANAGER_ADMIN", "MANAGER_PAUSER", "MANAGER_CONFIGURER", "REGISTRARS")
        for selected in (roles, ("INTENDED_CAM_ROOT_OWNER", "COMPONENTS_PAUSER", "MANAGER_CONFIGURER", "REGISTRARS")):
            with self.subTest(selected=selected), tempfile.TemporaryDirectory() as temporary:
                expected = configuration("bike-nft")
                for role in selected:
                    expected["settings"][role] = "0x" + FIXTURE_DEPLOYER_ADDRESS[2:].upper()
                expected["settings"]["REGISTRARS"] += "," + FIXTURE_ADDRESS
                answers = ["public", *expected["settings"].values(), "save"]
                root = Path(temporary)
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    complete_setup("bike-nft", COMMIT, root)
                saved = root / "release.json"
                self.assertEqual(expected, json.loads(saved.read_text()))
                output = root / "out"
                output.mkdir()
                unpack("bike-nft", COMMIT, "deploy", saved, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                for role in roles:
                    self.assertEqual(expected["settings"][role], inputs[f"BIKE_NFT_RELEASE_{role}"])

    def test_other_apps_can_keep_the_deployer_as_final_authority(self):
        for app in ("escrow", "pay-to-play"):
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                expected = configuration(app)
                expected["settings"]["INTENDED_CAM_ROOT_OWNER"] = FIXTURE_DEPLOYER_ADDRESS
                if app == "pay-to-play":
                    expected["settings"]["INTENDED_PAYMENT_ADMIN"] = FIXTURE_DEPLOYER_ADDRESS
                answers = ["public", *expected["settings"].values(), "save"]
                root = Path(temporary)
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()):
                    complete_setup(app, COMMIT, root)
                self.assertEqual(expected, json.loads((root / "release.json").read_text()))

    def test_setup_has_no_output_directory_field_or_question(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                expected = configuration(app)
                answers = iter(["public", *expected["settings"].values(), "save"])
                prompts = []
                def respond(prompt):
                    prompts.append(prompt)
                    return next(answers)
                with patch.object(release_config, "input", side_effect=respond, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()):
                    complete_setup(app, COMMIT, root)
                self.assertEqual(expected, json.loads((root / "release.json").read_text()))
                self.assertFalse(any("directory" in prompt.lower() or "folder" in prompt.lower() for prompt in prompts))
                self.assertNotIn("OUTPUT_DIR", expected["settings"])

    def test_allocated_output_is_an_in_memory_input_not_a_saved_configuration_fact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config = configuration("escrow")
            config["settings"]["OUTPUT_DIR"] = "/tmp/old-records"
            source = root / "config.json"
            source.write_text(json.dumps(config))
            before = source.read_bytes()
            with patch.dict(release_config.os.environ, {"RELEASE_CONFIG_OUTPUT_DIR": "/tmp/instance/deployments/one/contracts"}):
                release_config.unpack("escrow", COMMIT, "contracts-deploy", source, root)
            values = dict(item.split("=", 1) for item in (root / "inputs").read_text().split("\0") if item)
            self.assertEqual("/tmp/instance/deployments/one/contracts", values["CONTRACT_RELEASE_OUTPUT_DIR"])
            self.assertEqual(before, source.read_bytes())

    def test_ui_and_cam_setup_collect_only_their_operation_settings(self):
        for app in release_config.APP_FIELDS:
            for purpose, names in (("ui", {"EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS"}),
                                   ("cam", {"EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS", "CAM_URI", "CAM_HASH"})):
                with self.subTest(app=app, purpose=purpose), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    expected = configuration(app)
                    expected["settings"] = {name: value for name, value in expected["settings"].items() if name in names}
                    prompts = []
                    answers = iter(["public", *expected["settings"].values(), "save"])
                    def respond(prompt):
                        prompts.append(prompt)
                        return next(answers)
                    with patch.dict(release_config.os.environ, {"RELEASE_SETUP_PURPOSE": purpose}), patch.object(release_config, "input", side_effect=respond, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()):
                        complete_setup(app, COMMIT, root)
                    saved = json.loads((root / "release.json").read_text())
                    self.assertEqual(expected, saved)
                    self.assertEqual(names, set(saved["settings"]))
                    self.assertFalse(any("directory" in prompt.lower() or "collection" in prompt.lower() for prompt in prompts))

    def test_output_directory_requires_original_host_config_path_before_setup(self):
        with tempfile.TemporaryDirectory() as temporary, patch.dict(release_config.os.environ):
            del release_config.os.environ["RELEASE_CONFIG_FILE"]
            with patch.object(release_config, "input", side_effect=AssertionError("Missing host path must fail before asking questions"), create=True), self.assertRaisesRegex(ValueError, "RELEASE_CONFIG_FILE"):
                complete_setup("pay-to-play", COMMIT, Path(temporary))
            self.assertFalse((Path(temporary) / "release.json").exists())

    def test_bike_metadata_choices_save_canonical_values_and_unpack_empty_prefix(self):
        for prefix_answer, collection_answer in (("", ""), ("none", "inline"), ("https://metadata.example.test/tokens/", "https://metadata.example.test/collection.json"), ("", "data:application/json,%7B%22name%22%3A%22Custom%22%7D")):
            with self.subTest(prefix=prefix_answer, collection=collection_answer), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                expected = configuration("bike-nft")
                expected["settings"]["TOKEN_NAME"] = 'Vélos "東京"'
                expected["settings"]["TOKEN_SYMBOL"] = 'VÉ"東京'
                answers = ["public", *expected["settings"].values(), "save"]
                answers[1 + list(expected["settings"]).index("BASE_TOKEN_URI")] = prefix_answer
                answers[1 + list(expected["settings"]).index("COLLECTION_URI")] = collection_answer
                transcript = io.StringIO()
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                    complete_setup("bike-nft", COMMIT, root)
                saved = root / "release.json"
                config = json.loads(saved.read_text())
                self.assertEqual(expected["settings"]["TOKEN_SYMBOL"], config["settings"]["TOKEN_SYMBOL"])
                prefix = prefix_answer
                if prefix_answer == "none":
                    prefix = ""
                self.assertEqual(prefix, config["settings"]["BASE_TOKEN_URI"])
                collection = config["settings"]["COLLECTION_URI"]
                if collection_answer in ("", "inline"):
                    self.assertTrue(collection.startswith("data:application/json,"))
                    metadata = json.loads(unquote(collection.split(",", 1)[1]))
                    self.assertEqual({"name": expected["settings"]["TOKEN_NAME"]}, metadata)
                    self.assertIn(json.dumps(metadata, ensure_ascii=False), transcript.getvalue())
                else:
                    self.assertEqual(collection_answer, collection)
                output = root / "out"
                output.mkdir()
                unpack("bike-nft", COMMIT, "deploy", saved, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertIn("BIKE_NFT_RELEASE_BASE_TOKEN_URI", inputs)
                self.assertEqual(prefix, inputs["BIKE_NFT_RELEASE_BASE_TOKEN_URI"])
                self.assertEqual(collection, inputs["BIKE_NFT_RELEASE_COLLECTION_URI"])

    def test_bike_token_prefix_can_be_cleared_when_reviewing_settings(self):
        expected = configuration("bike-nft")
        initial = ["public", *expected["settings"].values(), "change"]
        revised_settings = dict(expected["settings"], BASE_TOKEN_URI="none")
        revised = [value for name, value in revised_settings.items() if name != "EXPECTED_CHAIN_ID"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(release_config, "input", side_effect=[*initial, *revised, "save"], create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()):
                complete_setup("bike-nft", COMMIT, root)
            self.assertEqual("", json.loads((root / "release.json").read_text())["settings"]["BASE_TOKEN_URI"])

    def test_bike_inline_metadata_overflow_reprompts_collection_without_losing_settings(self):
        expected = configuration("bike-nft")
        expected["settings"]["TOKEN_NAME"] = "x" * 4096
        expected["settings"]["COLLECTION_URI"] = "https://metadata.example.test/collection.json"
        answers = ["public", *expected["settings"].values(), "save"]
        collection_index = 1 + list(expected["settings"]).index("COLLECTION_URI")
        answers.insert(collection_index, "inline")
        errors = io.StringIO()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(errors):
                complete_setup("bike-nft", COMMIT, root)
            self.assertEqual(expected, json.loads((root / "release.json").read_text()))
        self.assertIn("inline collection metadata", errors.getvalue())
        self.assertIn("4096", errors.getvalue())

    def test_omitted_cam_hash_keeps_automatic_selection(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                config = configuration(app)
                del config["settings"]["CAM_HASH"]
                self.assertEqual(config, release_config.validate(config, app, COMMIT, purpose="deployment"))
                root = Path(temporary)
                saved = root / "release.json"
                saved.write_text(json.dumps(config))
                output = root / "out"
                output.mkdir()
                name = f"{app.upper().replace('-', '_')}_RELEASE_CAM_HASH"
                with patch.dict(release_config.os.environ, {name: "0x" + "00" * 32}):
                    unpack(app, COMMIT, "deploy", saved, output)
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual("auto", inputs[name])
                self.assertNotIn("CAM_HASH", json.loads(saved.read_text())["settings"])

    def test_zero_cam_hash_survives_setup_and_deployment_unpack_for_every_app(self):
        for app in release_config.APP_FIELDS:
            for selection in ("zero", "0x" + "00" * 32):
                with self.subTest(app=app, selection=selection), tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    expected = configuration(app)
                    expected["settings"]["CAM_HASH"] = "0x" + "00" * 32
                    answers = ["public", *[expected["settings"][name] for name, _, _ in release_config.fields(app)], "save"]
                    answers[1 + list(expected["settings"]).index("CAM_HASH")] = selection
                    with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(io.StringIO()):
                        complete_setup(app, COMMIT, root)
                    saved = root / "release.json"
                    self.assertEqual(expected, json.loads(saved.read_text()))
                    output = root / "out"
                    output.mkdir()
                    unpack(app, COMMIT, "deploy", saved, output)
                    self.assertIn(f"{app.upper().replace('-', '_')}_RELEASE_CAM_HASH={expected['settings']['CAM_HASH']}\0", (output / "inputs").read_text())

    def test_saved_configuration_does_not_accept_interactive_zero_shorthand(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app):
                config = configuration(app)
                config["settings"]["CAM_HASH"] = "zero"
                with self.assertRaisesRegex(ValueError, "Invalid CAM_HASH"):
                    release_config.validate(config, app, COMMIT, purpose="deployment")

    def test_walkthrough_produces_complete_ready_to_deploy_file_for_every_app(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                expected = configuration(app)
                answers = ["public", *expected["settings"].values(), "save"]
                answers[1 + list(expected["settings"]).index("CAM_HASH")] = ""
                transcript = io.StringIO()
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                    complete_setup(app, COMMIT, directory)
                saved = directory / "release.json"
                self.assertEqual(expected, json.loads(saved.read_text()))
                self.assertEqual(0o600, stat.S_IMODE(saved.stat().st_mode))
                self.assertNotIn(FIXTURE_RPC, transcript.getvalue())
                self.assertNotIn(FIXTURE_KEY, transcript.getvalue())
                self.assertNotIn("RPC_CHAIN", saved.read_text())
                self.assertNotIn("RPC_SERVICE", saved.read_text())
                output = directory / "unpacked"
                output.mkdir()
                unpack(app, COMMIT, "deploy", saved, output)
                prefix = app.upper().replace("-", "_")
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual("YES", inputs[f"CONFIRM_{prefix}_RELEASE_DEPLOY"])
                self.assertEqual(FIXTURE_DEPLOYER_ADDRESS, inputs[f"{prefix}_RELEASE_EXPECTED_DEPLOYER_ADDRESS"])
                for name, value in expected["settings"].items():
                    self.assertEqual(value, inputs[f"{prefix}_RELEASE_{name}"])
                self.assertEqual(FIXTURE_KEY + "\n", (output / "deployer-key").read_text())
                self.assertEqual(FIXTURE_RPC + "\n", (output / "rpc-url").read_text())
                self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in output.iterdir()))

    def test_planner_receives_explicit_zero_and_automatic_hash(self):
        for value in ("auto", "0x" + "00" * 32):
            with self.subTest(hash=value):
                services = rendered_compose_config(
                    (*makefile_compose_unit("CAM_RELEASE_DEPLOY_COMPOSE_FILES"), "compose/release/reference.yml", "compose/release/cam.yml"),
                    env={"CAM_RELEASE_HASH": value},
                )["services"]
                self.assertEqual(value, services["release-reference-prepare"]["environment"]["CAM_RELEASE_HASH"])

    def test_cancel_saves_nothing_and_change_replaces_the_reviewed_settings(self):
        app = "pay-to-play"
        for decision in ("cancel", "change"):
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                first = configuration(app)
                answers = ["public", *first["settings"].values(), decision]
                secrets = [FIXTURE_RPC, FIXTURE_KEY]
                if decision == "change":
                    changed = dict(first["settings"], NULL_CLAIM_PERIOD="7200")
                    answers.extend([*[value for name, value in changed.items() if name != "EXPECTED_CHAIN_ID"], "save"])
                    secrets.append("")
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=secrets), contextlib.redirect_stdout(io.StringIO()):
                    if decision == "cancel":
                        with self.assertRaisesRegex(ValueError, "cancelled"):
                            complete_setup(app, COMMIT, root)
                        self.assertFalse((root / "release.json").exists())
                        self.assertFalse((root / "deployer-key").exists())
                    else:
                        complete_setup(app, COMMIT, root)
                        saved = json.loads((root / "release.json").read_text())["settings"]
                        self.assertEqual("84532", saved["EXPECTED_CHAIN_ID"])
                        self.assertEqual("7200", saved["NULL_CLAIM_PERIOD"])

    def test_unknown_duplicate_malformed_unconfirmed_and_wrong_revision_files_fail_before_writes(self):
        valid = configuration("pay-to-play")
        invalid = [
            "{", b"\xff", "{\"app\":1,\"app\":2}",
            json.dumps(dict(valid, PATH="/untrusted")),
            json.dumps(dict(valid, confirmDeploy=False)),
            json.dumps(dict(valid, app="escrow")),
            json.dumps(dict(valid, sourceCommit="f" * 40)),
            json.dumps(dict(valid, settings=dict(valid["settings"], RPC_CHAIN="base-sepolia"))),
            json.dumps(dict(valid, settings={"EXPECTED_CHAIN_ID": "84532"})),
            json.dumps({key: value for key, value in valid.items() if key != "schemaVersion"}),
            json.dumps(dict(valid, schemaVersion=1)),
            json.dumps(dict(valid, schemaVersion="2")),
            json.dumps(dict(valid, settings={key: value for key, value in valid["settings"].items() if key != "EXPECTED_DEPLOYER_ADDRESS"})),
            json.dumps(dict(valid, rpcUrl="https://provider.example.test/{API_KEY}")),
            b" " * (release_config.MAX_CONFIG_BYTES + 1),
        ]
        for index, content in enumerate(invalid):
            with self.subTest(case=index), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_bytes(content.encode() if isinstance(content, str) else content)
                output = root / "out"
                output.mkdir()
                with self.assertRaises(ValueError):
                    unpack("pay-to-play", COMMIT, "deploy", source, output)
                self.assertEqual([], list(output.iterdir()))

    def test_previous_configuration_shape_requires_setup_again(self):
        previous = configuration("escrow")
        del previous["schemaVersion"]
        del previous["settings"]["EXPECTED_DEPLOYER_ADDRESS"]
        with self.assertRaisesRegex(ValueError, "run the release setup again"):
            release_config.validate(previous, "escrow", COMMIT, purpose="deployment")

    def test_invalid_operator_values_are_rejected_without_echoing_secrets(self):
        cases = {
            "chain": ["0", "31337", "1337", "01", "9007199254740992"],
            "address": ["0x" + "00" * 20, "not-an-address"],
            "addresses": [FIXTURE_ADDRESS + "," + FIXTURE_ADDRESS],
            "claim-period": ["-1", "2592001"], "delay": ["0", "281474976710656"],
            "path": ["relative", "/tmp/../out", "/tmp//out", "/tmp/out/"],
            "uri": ["http://example.test/main.json", "https://example.test/$(code)"],
            "rpc": ["http://rpc.example.test", "https://user:secret@rpc.example.test", "https://rpc.example.test:8545", "https://rpc.example.test/#secret"],
            "key": ["0x" + "00" * 32, "0x" + "ff" * 32, "private-fixture-credential"],
            "text": ["", "two\nlines", "embedded\0separator"],
            "optional-text": ["two\nlines", "embedded\0separator", "x" * 4097],
            "cam-hash": ["0", "0x0", "0x" + "00" * 31, "0x" + "gg" * 32],
        }
        for kind, values in cases.items():
            for value in values:
                with self.subTest(kind=kind), self.assertRaises(ValueError) as failure:
                    release_config.check_value(value, kind)
                if kind in ("rpc", "key"):
                    self.assertNotIn(value, str(failure.exception))

    def test_private_writes_refuse_existing_files_and_dangling_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            existing = root / "existing"
            existing.write_bytes(b"original")
            dangling = root / "dangling"
            dangling.symlink_to(root / "absent")
            for path in (existing, dangling):
                with self.subTest(path=path.name), self.assertRaises(FileExistsError):
                    release_config.write_private(path, b"replacement")
            self.assertEqual(b"original", existing.read_bytes())
            self.assertFalse((root / "absent").exists())

    def test_setup_and_loader_have_only_their_exact_offline_file_grants(self):
        services = rendered_compose_config("compose/release/config.yml")["services"]
        self.assertEqual("/tmp/release-config.json", services["release-setup"]["environment"]["RELEASE_CONFIG_FILE"])
        for name, service in services.items():
            with self.subTest(service=name):
                self.assertEqual("none", service["network_mode"])
                self.assertTrue(service["read_only"])
                self.assertEqual(["ALL"], service["cap_drop"])
                self.assertIn("no-new-privileges:true", service["security_opt"])
                expected = {"/tool/release_config.py", "/out"}
                if name == "release-instance":
                    expected |= {"/tool/release_instance.py", "/instance"}
                if name == "release-config":
                    expected |= {"/run/release.json", "/run/credentials.json"}
                self.assertEqual(expected, {mount["target"] for mount in service["volumes"]})
                for mount in service["volumes"]:
                    if mount["target"] not in ("/out", "/instance"):
                        self.assertTrue(mount["read_only"])
                    else:
                        self.assertIsNot(mount.get("read_only"), True)
                    self.assertIn(mount["bind"], ({}, {"create_host_path": False}))

    def test_local_setup_records_complete_connection_and_uses_funded_test_account(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                expected = configuration(app)
                expected["settings"]["CAM_URI"] = ""
                answers = ["local", *[value for name, value in expected["settings"].items() if name not in ("EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS")], "save"]
                with patch.dict(release_config.os.environ, {"RELEASE_LOCAL_NETWORK": "local-release-test"}), patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=AssertionError("Local setup must not request operator credentials")), contextlib.redirect_stdout(io.StringIO()):
                    complete_setup(app, COMMIT, root)
                config = json.loads((root / "release.json").read_text())
                self.assertEqual("local-release-test", config["localNetwork"])
                self.assertEqual("31338", config["settings"]["EXPECTED_CHAIN_ID"])
                self.assertEqual(f"http://release-cam:8080/{app}/main.json", config["settings"]["CAM_URI"])
                self.assertEqual(release_config.LOCAL_DEPLOYER_KEY, config["deployerPrivateKey"])
                self.assertEqual(release_config.LOCAL_DEPLOYER_ADDRESS, config["settings"]["EXPECTED_DEPLOYER_ADDRESS"])
                self.assertEqual(1, len(set(bytes.fromhex(config["deployerPrivateKey"][2:]))), "Local fixture keys must be an obvious repeated byte pattern")
                output = root / "verify"
                output.mkdir()
                unpack(app, COMMIT, "contracts-artifact", root / "release.json", output)
                inputs = (output / "inputs").read_text()
                self.assertIn("RELEASE_REHEARSAL=1\0", inputs)
                self.assertIn("RELEASE_REHEARSAL_NETWORK=local-release-test\0", inputs)
                self.assertFalse((output / "deployer-key").exists())

    def test_local_setup_can_select_published_cam_without_operator_credentials(self):
        for app in release_config.APP_FIELDS:
            for uri in ("https://cam.example.test/releases/main.json", "ipfs://bafybeigdyrzt5sfp7udm7hu76zryo5bugubxgwf3d2wwuom2gkdcbx3zva/main.json"):
                with self.subTest(app=app, uri=uri), tempfile.TemporaryDirectory() as temporary:
                    expected = configuration(app)
                    expected["settings"].update(CAM_URI=uri, CAM_HASH="0x" + "00" * 32)
                    answers = ["local", *[value for name, value in expected["settings"].items() if name not in ("EXPECTED_CHAIN_ID", "EXPECTED_DEPLOYER_ADDRESS")], "save"]
                    with patch.dict(release_config.os.environ, {"RELEASE_LOCAL_NETWORK": "local-release-test"}), patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=AssertionError("Local setup must not request operator credentials")), contextlib.redirect_stdout(io.StringIO()):
                        complete_setup(app, COMMIT, Path(temporary))
                    config = json.loads((Path(temporary) / "release.json").read_text())
                    self.assertEqual(uri, config["settings"]["CAM_URI"])
                    self.assertEqual(expected["settings"]["CAM_HASH"], config["settings"]["CAM_HASH"])
                    self.assertEqual(release_config.LOCAL_RPC_URL, config["rpcUrl"])
                    self.assertEqual(release_config.LOCAL_DEPLOYER_KEY, config["deployerPrivateKey"])

    def test_local_transport_is_confined_to_the_fixture_chain_and_peers(self):
        config = configuration("pay-to-play")
        config["localNetwork"] = "local-release-test"
        config["rpcUrl"] = release_config.LOCAL_RPC_URL
        config["deployerPrivateKey"] = release_config.LOCAL_DEPLOYER_KEY
        config["settings"].update(EXPECTED_CHAIN_ID="31338", EXPECTED_DEPLOYER_ADDRESS=release_config.LOCAL_DEPLOYER_ADDRESS, CAM_URI="http://release-cam:8080/pay-to-play/main.json")
        release_config.validate(config, "pay-to-play", COMMIT, purpose="deployment")
        for top_level, name, value in (
            (True, "localNetwork", "unsafe network"),
            (True, "localNetwork", "--argument"),
            (True, "rpcUrl", "http://127.0.0.1:8545"),
            (True, "rpcUrl", "https://rpc.example.test"),
            (True, "deployerPrivateKey", FIXTURE_KEY),
            (False, "EXPECTED_CHAIN_ID", "84532"),
            (False, "CAM_URI", "http://release-cam:8080/escrow/main.json"),
            (False, "CAM_URI", "http://localhost/main.json"),
            (False, "CAM_URI", "http://release-cam:8080/pay-to-play/main.json?other=1"),
            (False, "EXPECTED_DEPLOYER_ADDRESS", FIXTURE_ADDRESS),
        ):
            changed = json.loads(json.dumps(config))
            if top_level:
                changed[name] = value
            else:
                changed["settings"][name] = value
            with self.subTest(field=name), self.assertRaises(ValueError):
                release_config.validate(changed, "pay-to-play", COMMIT, purpose="deployment")
        del config["localNetwork"]
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            release_config.validate(config, "pay-to-play", COMMIT, purpose="deployment")

    def test_manual_network_has_no_app_deployment_or_public_network_authority(self):
        config = rendered_compose_config("compose/release/local-network.yml", env={"COMPOSE_PROFILES": "internal"})
        self.assertEqual({"release-anvil", "release-cam"}, set(config["services"]))
        self.assertTrue(all(network["internal"] for network in config["networks"].values()))
        for service in config["services"].values():
            self.assertTrue(service["read_only"])
            self.assertEqual(["ALL"], service["cap_drop"])
            self.assertNotIn("ports", service)
            self.assertNotIn("secrets", service)
            for mount in compose_sequence_or_empty(service, "volumes"):
                self.assertTrue(mount["read_only"])
        self.assertIn("31338", config["services"]["release-anvil"]["command"])


if __name__ == "__main__":
    unittest.main()
