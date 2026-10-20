from __future__ import annotations

import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

from .common import repo_path, rendered_compose_config


class RpcCatalogTest(unittest.TestCase):
    def test_resolver_container_has_only_its_catalog_source_and_output(self) -> None:
        service = rendered_compose_config("compose/release/rpc.yml")["services"]["rpc-resolve"]
        self.assertEqual("none", service["network_mode"])
        self.assertIs(True, service["read_only"])
        self.assertEqual(["ALL"], service["cap_drop"])
        self.assertEqual({"/catalog/resolve_rpc.py", "/catalog/rpc-catalog.json", "/out"}, {volume["target"] for volume in service["volumes"]})
        for volume in service["volumes"]:
            self.assertIn(volume["bind"], ({}, {"create_host_path": False}))
            if volume["target"] != "/out":
                self.assertIs(True, volume["read_only"])

    def resolve(self, directory: Path, chain: str, service: str, key: str = "", script: Path | None = None, expected_chain: str = ""):
        command = [sys.executable, "-I", "-B", str(script if script is not None else repo_path("tools/resolve_rpc.py")), chain, service, str(directory / "rpc-url"), expected_chain]
        credential = b""
        if key:
            command.append("--api-key-stdin")
            credential = Path(key).read_bytes()
        result = subprocess.run(command, input=credential, capture_output=True, check=False)
        return subprocess.CompletedProcess(result.args, result.returncode, result.stdout.decode(), result.stderr.decode())

    def test_every_catalog_entry_resolves_without_revealing_credentials(self) -> None:
        with repo_path("tools/rpc-catalog.json").open() as source:
            entries = json.load(source)
        self.assertTrue(entries)
        for network, entry in entries.items():
            for service, endpoint in entry["services"].items():
                with self.subTest(network=network, service=service), tempfile.TemporaryDirectory() as temporary:
                    directory = Path(temporary)
                    key = directory / "api-key"
                    key.write_text("fixture_api-key123\n")
                    key_path = ""
                    if "{API_KEY}" in endpoint:
                        key_path = str(key)
                    result = self.resolve(directory, network, service, key_path)
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertIn(str(entry["chainId"]), result.stdout)
                    self.assertIn(network, result.stdout)
                    self.assertEqual("", result.stderr)
                    expected = endpoint.replace("{API_KEY}", "fixture_api-key123")
                    self.assertNotIn("fixture_api-key123", result.stdout + result.stderr)
                    self.assertNotIn(expected, result.stdout + result.stderr)
                    self.assertEqual(expected + "\n", (directory / "rpc-url").read_text())
                    self.assertEqual(0o600, stat.S_IMODE((directory / "rpc-url").stat().st_mode))

    def test_invalid_selection_or_credentials_produce_no_endpoint_file(self) -> None:
        cases = [
            ("unknown", "public", None),
            ("network", "public", None),
            ("base-sepolia", "unknown", None),
            ("base-sepolia", "alchemy", None),
            ("base-sepolia", "public", "unnecessary-key"),
            ("base-sepolia", "alchemy", ""),
            ("base-sepolia", "alchemy", "a" * 257),
            ("base-sepolia", "alchemy", "secret?query=1"),
            ("base-sepolia", "alchemy", "secret\nsecond-line"),
            ("base-sepolia", "alchemy", "secret\x00suffix"),
            ("base-sepolia", "alchemy", "secret\r\n"),
            ("base-sepolia", "alchemy", "secret\n\n"),
            ("base-sepolia", "alchemy", "secreté"),
        ]
        for chain, service, credential in cases:
            with self.subTest(chain=chain, service=service), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                key = directory / "api-key"
                if credential is not None:
                    key.write_text(credential)
                key_path = ""
                if credential is not None:
                    key_path = str(key)
                result = self.resolve(directory, chain, service, key_path)
                self.assertNotEqual(0, result.returncode)
                self.assertFalse((directory / "rpc-url").exists())
                self.assertEqual("", result.stdout)
                self.assertNotIn("secret", result.stderr)

    def test_resolution_refuses_to_overwrite_an_existing_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            output = directory / "rpc-url"
            output.write_text("existing endpoint\n")
            result = self.resolve(directory, "base-sepolia", "public")
            self.assertNotEqual(0, result.returncode)
            self.assertEqual("existing endpoint\n", output.read_text())

    def test_resolution_does_not_follow_existing_or_dangling_output_symlinks(self) -> None:
        for existing in (False, True):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                target = directory / "target"
                if existing:
                    target.write_text("keep this\n")
                (directory / "rpc-url").symlink_to(target)
                result = self.resolve(directory, "base-sepolia", "public")
                self.assertNotEqual(0, result.returncode)
                if existing:
                    self.assertEqual("keep this\n", target.read_text())
                else:
                    self.assertFalse(target.exists())

    def test_new_network_flows_from_catalog_without_resolver_changes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            script = directory / "resolve_rpc.py"
            shutil.copyfile(repo_path("tools/resolve_rpc.py"), script)
            catalog = {"future-testnet": {"chainId": 123456789, "services": {"public": "https://rpc.example.test"}}}
            (directory / "rpc-catalog.json").write_text(json.dumps(catalog))
            result = self.resolve(directory, "future-testnet", "public", script=script)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("123456789", result.stdout)
            self.assertEqual("https://rpc.example.test\n", (directory / "rpc-url").read_text())
            (directory / "rpc-url").unlink()
            unavailable = self.resolve(directory, "future-testnet", "alchemy", script=script)
            self.assertNotEqual(0, unavailable.returncode)
            self.assertFalse((directory / "rpc-url").exists())

    def test_selected_network_must_match_the_explicit_release_chain(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            result = self.resolve(directory, "base-sepolia", "public", expected_chain="11155111")
            self.assertNotEqual(0, result.returncode)
            self.assertIn("84532", result.stderr)
            self.assertIn("11155111", result.stderr)
            self.assertFalse((directory / "rpc-url").exists())
            accepted = self.resolve(directory, "base-sepolia", "public", expected_chain="84532")
            self.assertEqual(0, accepted.returncode, accepted.stderr)

    def test_malformed_json_and_network_entries_fail_before_writing(self) -> None:
        catalogs = [
            "{",
            '{"base-sepolia": {}, "base-sepolia": {}}',
            "[]",
            '{"base-sepolia": {"chainId": true, "services": {"public": "https://rpc.example.test"}}}',
            '{"base-sepolia": {"chainId": 84532, "services": []}}',
            '{"base-sepolia": {"chainId": 84532, "services": {"public": 42}}}',
        ]
        for catalog in catalogs:
            with self.subTest(catalog=catalog), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                script = directory / "resolve_rpc.py"
                shutil.copyfile(repo_path("tools/resolve_rpc.py"), script)
                (directory / "rpc-catalog.json").write_text(catalog)
                result = self.resolve(directory, "base-sepolia", "public", script=script)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertFalse((directory / "rpc-url").exists())
