from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

from tools import release_config
from .common import compose_sequence_or_empty, rendered_compose_config


COMMIT = "0123456789abcdef0123456789abcdef01234567"
FIXTURE_KEY = "0x" + "11" * 32
FIXTURE_ADDRESS = "0x" + "22" * 20
FIXTURE_RPC = "https://rpc.example.test/private-fixture-credential"


def configuration(app):
    values = {
        "chain": "84532", "uri": "https://cam.example.test/releases/main.json",
        "address": FIXTURE_ADDRESS, "addresses": FIXTURE_ADDRESS,
        "claim-period": "86400", "delay": "86400", "text": "Fixture collection",
        "path": "/tmp/new-release-output",
    }
    return {
        "app": app, "sourceCommit": COMMIT, "rpcUrl": FIXTURE_RPC,
        "deployerPrivateKey": FIXTURE_KEY, "confirmDeploy": True,
        "settings": {name: values[kind] for name, _, kind in release_config.fields(app)},
    }


class ReleaseConfigTest(unittest.TestCase):
    def test_walkthrough_produces_complete_ready_to_deploy_file_for_every_app(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                expected = configuration(app)
                answers = ["public", *expected["settings"].values(), "save"]
                transcript = io.StringIO()
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=[FIXTURE_RPC, FIXTURE_KEY]), contextlib.redirect_stdout(transcript):
                    release_config.setup(app, COMMIT, directory)
                saved = directory / "release.json"
                self.assertEqual(expected, json.loads(saved.read_text()))
                self.assertEqual(0o600, stat.S_IMODE(saved.stat().st_mode))
                self.assertNotIn(FIXTURE_RPC, transcript.getvalue())
                self.assertNotIn(FIXTURE_KEY, transcript.getvalue())
                self.assertNotIn("RPC_CHAIN", saved.read_text())
                self.assertNotIn("RPC_SERVICE", saved.read_text())
                output = directory / "unpacked"
                output.mkdir()
                release_config.unpack(app, COMMIT, "deploy", saved, output)
                prefix = app.upper().replace("-", "_")
                inputs = dict(item.split("=", 1) for item in (output / "inputs").read_text().split("\0") if item)
                self.assertEqual("YES", inputs[f"CONFIRM_{prefix}_RELEASE_DEPLOY"])
                for name, value in expected["settings"].items():
                    self.assertEqual(value, inputs[f"{prefix}_RELEASE_{name}"])
                self.assertEqual(FIXTURE_KEY + "\n", (output / "deployer-key").read_text())
                self.assertEqual(FIXTURE_RPC + "\n", (output / "rpc-url").read_text())
                self.assertTrue(all(stat.S_IMODE(path.stat().st_mode) == 0o600 for path in output.iterdir()))

    def test_verify_uses_saved_output_and_does_not_materialize_a_signing_key(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = root / "config.json"
                source.write_text(json.dumps(configuration(app)))
                output = root / "verify"
                output.mkdir()
                release_config.unpack(app, COMMIT, "verify", source, output)
                self.assertEqual({"inputs", "rpc-url"}, {path.name for path in output.iterdir()})
                self.assertEqual(f"{app.upper().replace('-', '_')}_DEPLOYMENT_ARTIFACT_FILE=/tmp/new-release-output/artifact/deployment.json\0RELEASE_REHEARSAL=0\0", (output / "inputs").read_text())

    def test_cancel_saves_nothing_and_change_replaces_the_reviewed_settings(self):
        app = "pay-to-play"
        for decision in ("cancel", "change"):
            with self.subTest(decision=decision), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                first = configuration(app)
                answers = ["public", *first["settings"].values(), decision]
                secrets = [FIXTURE_RPC, FIXTURE_KEY]
                if decision == "change":
                    changed = dict(first["settings"], EXPECTED_CHAIN_ID="11155111")
                    answers.extend([*changed.values(), "save"])
                    secrets.extend(["", ""])
                with patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=secrets), contextlib.redirect_stdout(io.StringIO()):
                    if decision == "cancel":
                        with self.assertRaisesRegex(ValueError, "cancelled"):
                            release_config.setup(app, COMMIT, root)
                        self.assertEqual([], list(root.iterdir()))
                    else:
                        release_config.setup(app, COMMIT, root)
                        self.assertEqual("11155111", json.loads((root / "release.json").read_text())["settings"]["EXPECTED_CHAIN_ID"])

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
                    release_config.unpack("pay-to-play", COMMIT, "deploy", source, output)
                self.assertEqual([], list(output.iterdir()))

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
            "text": ["two\nlines", "embedded\0separator"],
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
        for name, service in services.items():
            with self.subTest(service=name):
                self.assertEqual("none", service["network_mode"])
                self.assertTrue(service["read_only"])
                self.assertEqual(["ALL"], service["cap_drop"])
                self.assertIn("no-new-privileges:true", service["security_opt"])
                expected = {"/tool/release_config.py", "/out"}
                if name == "release-config":
                    expected.add("/run/release.json")
                self.assertEqual(expected, {mount["target"] for mount in service["volumes"]})
                for mount in service["volumes"]:
                    if mount["target"] != "/out":
                        self.assertTrue(mount["read_only"])
                    self.assertIn(mount["bind"], ({}, {"create_host_path": False}))

    def test_local_setup_records_complete_connection_and_uses_funded_test_account(self):
        for app in release_config.APP_FIELDS:
            with self.subTest(app=app), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                expected = configuration(app)
                answers = ["local", *[value for name, value in expected["settings"].items() if name not in ("EXPECTED_CHAIN_ID", "CAM_URI")], "save"]
                with patch.dict(release_config.os.environ, {"RELEASE_LOCAL_NETWORK": "local-release-test"}), patch.object(release_config, "input", side_effect=answers, create=True), patch.object(release_config.getpass, "getpass", side_effect=AssertionError("Local setup must not request operator credentials")), contextlib.redirect_stdout(io.StringIO()):
                    release_config.setup(app, COMMIT, root)
                config = json.loads((root / "release.json").read_text())
                self.assertEqual("local-release-test", config["localNetwork"])
                self.assertEqual("31338", config["settings"]["EXPECTED_CHAIN_ID"])
                self.assertEqual(f"http://release-cam:8080/{app}/main.json", config["settings"]["CAM_URI"])
                self.assertEqual(release_config.LOCAL_DEPLOYER_KEY, config["deployerPrivateKey"])
                self.assertEqual(1, len(set(bytes.fromhex(config["deployerPrivateKey"][2:]))), "Local fixture keys must be an obvious repeated byte pattern")
                output = root / "verify"
                output.mkdir()
                release_config.unpack(app, COMMIT, "verify", root / "release.json", output)
                inputs = (output / "inputs").read_text()
                self.assertIn("RELEASE_REHEARSAL=1\0", inputs)
                self.assertIn("RELEASE_REHEARSAL_NETWORK=local-release-test\0", inputs)
                self.assertFalse((output / "deployer-key").exists())

    def test_local_transport_is_confined_to_the_fixture_chain_and_peers(self):
        config = configuration("pay-to-play")
        config["localNetwork"] = "local-release-test"
        config["rpcUrl"] = release_config.LOCAL_RPC_URL
        config["settings"].update(EXPECTED_CHAIN_ID="31338", CAM_URI="http://release-cam:8080/pay-to-play/main.json")
        release_config.validate(config, "pay-to-play", COMMIT)
        for top_level, name, value in (
            (True, "localNetwork", "unsafe network"),
            (True, "localNetwork", "--argument"),
            (True, "rpcUrl", "http://127.0.0.1:8545"),
            (True, "rpcUrl", "https://rpc.example.test"),
            (False, "EXPECTED_CHAIN_ID", "84532"),
            (False, "CAM_URI", "http://release-cam:8080/escrow/main.json"),
        ):
            changed = json.loads(json.dumps(config))
            if top_level:
                changed[name] = value
            else:
                changed["settings"][name] = value
            with self.subTest(field=name), self.assertRaises(ValueError):
                release_config.validate(changed, "pay-to-play", COMMIT)
        del config["localNetwork"]
        with self.assertRaisesRegex(ValueError, "HTTPS"):
            release_config.validate(config, "pay-to-play", COMMIT)

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
