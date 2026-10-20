from __future__ import annotations

import csv
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

from .common import repo_path


class RpcCatalogTest(unittest.TestCase):
    def resolve(self, directory: Path, chain: str, service: str, key: str = "", script: Path | None = None, expected_chain: str = ""):
        return subprocess.run(
            ["sh", str(script if script is not None else repo_path("tools/resolve_rpc.sh")), chain, service, key, str(directory / "rpc-url"), expected_chain],
            capture_output=True, text=True, check=False,
        )

    def test_every_catalog_entry_resolves_without_revealing_credentials(self) -> None:
        with repo_path("tools/rpc-catalog.tsv").open() as source:
            entries = list(csv.DictReader(source, delimiter="\t"))
        self.assertTrue(entries)
        self.assertEqual(len(entries), len({entry["network"] for entry in entries}))
        for entry in entries:
            for service in ("public", "alchemy"):
                with self.subTest(network=entry["network"], service=service), tempfile.TemporaryDirectory() as temporary:
                    directory = Path(temporary)
                    key = directory / "api-key"
                    key.write_text("fixture_api-key123\n")
                    key_path = ""
                    if service == "alchemy":
                        key_path = str(key)
                    result = self.resolve(directory, entry["network"], service, key_path)
                    if entry[service] == "-":
                        self.assertNotEqual(0, result.returncode)
                        self.assertFalse((directory / "rpc-url").exists())
                        continue
                    self.assertEqual(0, result.returncode, result.stderr)
                    self.assertIn(entry["chain_id"], result.stdout)
                    self.assertIn(entry["network"], result.stdout)
                    self.assertEqual("", result.stderr)
                    expected = entry[service].replace("{API_KEY}", "fixture_api-key123")
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
            script = directory / "resolve_rpc.sh"
            shutil.copyfile(repo_path("tools/resolve_rpc.sh"), script)
            shutil.copyfile(repo_path("tools/rpc-catalog.tsv"), directory / "rpc-catalog.tsv")
            with (directory / "rpc-catalog.tsv").open("a") as catalog:
                catalog.write("future-testnet\t123456789\thttps://rpc.example.test\t-\n")
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
