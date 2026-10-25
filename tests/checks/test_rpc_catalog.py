from __future__ import annotations

import json
from datetime import date
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

from .common import repo_path, rendered_compose_config


class RpcCatalogTest(unittest.TestCase):
    def test_reference_metadata_pairs_each_mainnet_with_one_testnet(self) -> None:
        catalog = json.loads(repo_path("js/packages/cam-viewer/src/rpc-catalog.json").read_text())
        mainnets = {key: chain for key, chain in catalog.items() if "mainnet" not in chain}
        indexes = [chain["index"] for chain in mainnets.values()]
        self.assertEqual(len(indexes), len(set(indexes)))
        self.assertTrue(all(type(index) is int and index > 0 for index in indexes))
        self.assertEqual(len(catalog), len({chain["chainId"] for chain in catalog.values()}))
        for key, chain in catalog.items():
            with self.subTest(network=key):
                for field in ("name", "symbol"):
                    self.assertIsInstance(chain[field], str)
                    self.assertTrue(chain[field].strip())
                self.assertEqual(chain["checkedOn"], date.fromisoformat(chain["checkedOn"]).isoformat())
                self.assertTrue(chain["references"])
                for url in [chain["explorer"], *chain["references"], *chain["services"].values()]:
                    parsed = urlsplit(url)
                    self.assertEqual("https", parsed.scheme)
                    self.assertTrue(parsed.hostname)
                    self.assertIsNone(parsed.username)
                    self.assertIsNone(parsed.password)
                if "mainnet" in chain:
                    self.assertIn(chain["mainnet"], mainnets)
                    self.assertNotIn("index", chain)
                else:
                    self.assertEqual(1, sum(testnet.get("mainnet") == key for testnet in catalog.values()))
                if chain.get("retired"):
                    self.assertEqual({}, chain["services"])
                    self.assertTrue(chain["note"].strip())
                else:
                    self.assertIn("public", chain["services"])

    def test_retired_networks_cannot_supply_a_release_endpoint(self) -> None:
        catalog = json.loads(repo_path("js/packages/cam-viewer/src/rpc-catalog.json").read_text())
        for network, chain in catalog.items():
            if chain.get("retired"):
                with self.subTest(network=network), tempfile.TemporaryDirectory() as temporary:
                    directory = Path(temporary)
                    result = self.resolve(directory, network, "public")
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse((directory / "rpc-url").exists())

    def test_resolver_container_has_only_its_catalog_source_and_output(self) -> None:
        service = rendered_compose_config("compose/release/rpc.yml")["services"]["rpc-resolve"]
        self.assertEqual("none", service["network_mode"])
        self.assertEqual(["python3", "-I", "-B", "/catalog/resolve_rpc.py", "/catalog/rpc-catalog.json"], service["entrypoint"])
        self.assertIs(True, service["read_only"])
        self.assertEqual(["ALL"], service["cap_drop"])
        self.assertEqual({"/catalog/resolve_rpc.py", "/catalog/rpc-catalog.json", "/out"}, {volume["target"] for volume in service["volumes"]})
        for volume in service["volumes"]:
            self.assertIn(volume["bind"], ({}, {"create_host_path": False}))
            if volume["target"] != "/out":
                self.assertIs(True, volume["read_only"])
            if volume["target"] == "/catalog/rpc-catalog.json":
                self.assertEqual(str(repo_path("js/packages/cam-viewer/src/rpc-catalog.json")), volume["source"])

    def resolve(self, directory: Path, chain: str, service: str, key: str = "", catalog: Path | None = None, expected_chain: str = ""):
        command = [sys.executable, "-I", "-B", str(repo_path("tools/resolve_rpc.py")), str(catalog if catalog is not None else repo_path("js/packages/cam-viewer/src/rpc-catalog.json")), chain, service, str(directory / "rpc-url"), expected_chain]
        credential = b""
        if key:
            command.append("--api-key-stdin")
            credential = Path(key).read_bytes()
        result = subprocess.run(command, input=credential, capture_output=True, check=False)
        return subprocess.CompletedProcess(result.args, result.returncode, result.stdout.decode(), result.stderr.decode())

    def test_every_catalog_entry_resolves_without_revealing_credentials(self) -> None:
        with repo_path("js/packages/cam-viewer/src/rpc-catalog.json").open() as source:
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
            catalog = {"future-testnet": {"chainId": 123456789, "services": {"public": "https://rpc.example.test"}}}
            (directory / "rpc-catalog.json").write_text(json.dumps(catalog))
            result = self.resolve(directory, "future-testnet", "public", catalog=directory / "rpc-catalog.json")
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("123456789", result.stdout)
            self.assertEqual("https://rpc.example.test\n", (directory / "rpc-url").read_text())
            (directory / "rpc-url").unlink()
            unavailable = self.resolve(directory, "future-testnet", "alchemy", catalog=directory / "rpc-catalog.json")
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
                (directory / "rpc-catalog.json").write_text(catalog)
                result = self.resolve(directory, "base-sepolia", "public", catalog=directory / "rpc-catalog.json")
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertFalse((directory / "rpc-url").exists())
