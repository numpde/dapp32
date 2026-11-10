"""Offline tests of the keyless RPC catalog probe, result contract and publisher."""

from contextlib import redirect_stderr
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch
import importlib.util

SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "rpc_catalog_probe.py"
spec = importlib.util.spec_from_file_location("rpc_catalog_probe_test", SCRIPT)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class FakeRpc:
    def __init__(self, _endpoint):
        self.calls = []

    def call(self, method, params):
        self.calls.append((method, params))
        height = 10
        block_hash = "0x" + "12" * 32
        transaction_hash = "0x" + "34" * 32
        if method == "eth_chainId":
            return "0x1", 1
        if method == "eth_blockNumber":
            return hex(height), 1
        if method == "eth_getBlockByNumber":
            if params[0] in ("safe", "finalized"):
                return {"number": "0x6", "hash": "0x" + "13" * 32, "parentHash": "0x" + "14" * 32}, 1
            selected = int(params[0], 16)
            return {"number": hex(selected), "hash": (block_hash if selected == 8 else "0x" + "15" * 32),
                    "parentHash": "0x" + "16" * 32,
                    "transactions": [transaction_hash] if selected == 8 else []}, 1
        if method == "eth_getBlockByHash":
            return {"number": "0x8", "hash": block_hash, "parentHash": "0x" + "16" * 32}, 1
        if method == "eth_getLogs":
            event = {
                "address": "0x" + "17" * 20,
                "topics": [probe.TRANSFER_TOPIC],
                "blockNumber": "0x8", "blockHash": block_hash,
                "transactionHash": transaction_hash, "logIndex": "0x0",
            }
            return [event], 2
        if method == "eth_call":
            if params[1]["blockHash"] == probe.UNKNOWN_HASH:
                raise probe.ProbeFailure("rpc_error", -32000)
            return probe.IDENTITY_INPUT, 3
        if method == "eth_getCode":
            return "0x", 1
        if method == "eth_getStorageAt":
            return "0x" + "00" * 32, 1
        if method == "eth_getBalance":
            return "0x0", 1
        if method == "eth_getTransactionReceipt":
            return {"blockHash": block_hash, "transactionHash": transaction_hash}, 1
        if method == "eth_getTransactionByHash":
            return {"hash": transaction_hash, "blockHash": block_hash}, 1
        if method == "eth_getBlockReceipts":
            return [{"blockHash": block_hash, "transactionHash": transaction_hash}], 1
        raise AssertionError("Unexpected method " + method)


def sample_catalog():
    return {
        "ethereum-mainnet": {
            "chainId": 1,
            "services": {
                "public": "https://example.org/chain",
                "alchemy": "https://example.org/{API_KEY}",
            },
        },
        "retired": {"chainId": 2, "retired": True, "services": {}},
    }


class CatalogAdmissionTests(unittest.TestCase):
    def test_catalog_excludes_embedded_credentials_and_unauthorized_urls(self):
        for address in (
            "http://example.org/rpc", "https://user:pass@example.org/rpc",
            "https://example.org/rpc#fragment", "https://example.org/{UNKNOWN}",
        ):
            catalog = {"ethereum": {"chainId": 1, "services": {"public": address}}}
            with self.subTest(address=address), tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "catalog.json"
                path.write_text(json.dumps(catalog))
                with self.assertRaises(ValueError):
                    probe.read_catalog(path)

    def test_catalog_rejects_duplicate_networks_and_bool_chain_ids(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "catalog.json"
            for content in (
                '{"test":{"chainId":1,"services":{}},"test":{"chainId":2,"services":{}}}',
                '{"test":{"chainId":true,"services":{}}}',
            ):
                path.write_text(content)
                with self.subTest(content=content), self.assertRaises(ValueError):
                    probe.read_catalog(path)

    def test_report_covers_every_service_and_does_not_call_key_templates(self):
        catalog = sample_catalog()
        digest = "a" * 64
        with patch.object(probe, "JsonRpc", FakeRpc), redirect_stderr(io.StringIO()):
            report = probe.probe_catalog(catalog, digest)
        probe.validate_report(report, catalog, digest)
        self.assertEqual(report["networks"]["ethereum-mainnet"]["services"]["alchemy"]["status"], "requires_api_key")
        public = report["networks"]["ethereum-mainnet"]["services"]["public"]
        self.assertEqual(public["status"], "probed")
        self.assertEqual(set(public["checks"]), set(probe.CHECKS))
        self.assertEqual(public["checks"]["eth_getLogs:range"]["matches"], 1)
        self.assertEqual(public["checks"]["eth_getLogs:blockHash"]["matches"], 1)
        self.assertEqual(public["checks"]["eth_call:unknownBlockHash"]["status"], "rejected_unknown_hash")
        self.assertEqual(report["networks"]["retired"]["services"], {})

    def test_failed_source_and_wrong_chain_cannot_report_method_success(self):
        class WrongChain(FakeRpc):
            def call(self, method, params):
                if method == "eth_chainId":
                    return "0x2", 1
                raise AssertionError("Should not probe other methods after source mismatch")

        with patch.object(probe, "JsonRpc", WrongChain):
            result = probe.probe_provider("network", "public", "https://example.org", 1)
        self.assertEqual(result["status"], "wrong_chain")
        self.assertEqual(result["observed_chain_id"], 2)
        self.assertEqual(list(result["checks"]), ["eth_chainId"])

    def test_nonexistent_block_hash_must_be_rejected_even_if_reply_is_empty(self):
        class IgnoresHash(FakeRpc):
            def call(self, method, params):
                if method == "eth_call" and params[1]["blockHash"] == probe.UNKNOWN_HASH:
                    return "0x", 1
                return super().call(method, params)

        with patch.object(probe, "JsonRpc", IgnoresHash):
            result = probe.probe_provider("network", "public", "https://example.org", 1)
        self.assertEqual(result["checks"]["eth_call:unknownBlockHash"]["status"],
                         "inconsistent_accepted_nonexistent_hash")

    def test_hash_log_query_must_match_the_requested_block_hash(self):
        class WrongBlockHash(FakeRpc):
            def call(self, method, params):
                if method == "eth_getLogs" and "blockHash" in params[0]:
                    rows, duration = super().call(method, params)
                    return [{**row, "blockHash": "0x" + "ff" * 32} for row in rows], duration
                return super().call(method, params)

        with patch.object(probe, "JsonRpc", WrongBlockHash):
            result = probe.probe_provider("network", "public", "https://example.org", 1)
        self.assertEqual(result["checks"]["eth_getLogs:blockHash"]["status"], "inconsistent")

    def test_contradictory_empty_range_and_nonempty_block_hash_query(self):
        class ContradictoryLogs(FakeRpc):
            def call(self, method, params):
                if method == "eth_getLogs" and "fromBlock" in params[0]:
                    return [], 1
                return super().call(method, params)

        with patch.object(probe, "JsonRpc", ContradictoryLogs):
            result = probe.probe_provider("network", "public", "https://example.org", 1)
        self.assertEqual(result["checks"]["eth_getLogs:range"]["status"], "inconclusive_empty")
        self.assertEqual(result["checks"]["eth_getLogs:blockHash"]["status"], "inconsistent")

    def test_mismatched_log_contents_cannot_count_as_hash_query_success(self):
        class LyingLogs(FakeRpc):
            def call(self, method, params):
                if method == "eth_getLogs" and "blockHash" in params[0]:
                    return [], 1
                return super().call(method, params)

        with patch.object(probe, "JsonRpc", LyingLogs):
            result = probe.probe_provider("network", "public", "https://example.org", 1)
        self.assertEqual(result["checks"]["eth_getLogs:blockHash"]["status"], "inconsistent")

    def test_invalid_or_incomplete_result_cannot_replace_a_report(self):
        catalog, digest = sample_catalog(), "d" * 64
        with patch.object(probe, "JsonRpc", FakeRpc), redirect_stderr(io.StringIO()):
            report = probe.probe_catalog(catalog, digest)
        missing_provider = json.loads(json.dumps(report))
        del missing_provider["networks"]["ethereum-mainnet"]["services"]["alchemy"]
        with self.assertRaises(ValueError):
            probe.validate_report(missing_provider, catalog, digest)
        incomplete_methods = json.loads(json.dumps(report))
        del incomplete_methods["networks"]["ethereum-mainnet"]["services"]["public"]["checks"]["eth_getLogs:blockHash"]
        with self.assertRaises(ValueError):
            probe.validate_report(incomplete_methods, catalog, digest)
        no_valid_source = json.loads(json.dumps(report))
        no_valid_source["networks"]["ethereum-mainnet"]["services"]["public"] = {
            "endpoint": "https://example.org/chain", "status": "source_unavailable", "checks": {"eth_chainId": {"status": "transport_error"}},
        }
        with self.assertRaises(ValueError):
            probe.validate_report(no_valid_source, catalog, digest)


class RpcWireTests(unittest.TestCase):
    def test_hex_quantities_have_exact_uint256_bounds(self):
        self.assertEqual(probe.hex_quantity(hex((1 << 256) - 1)), (1 << 256) - 1)
        for invalid in ("0x00", "0x", "0xA", 0, 1.0, None, "0x" + "f" * 65):
            with self.subTest(value=repr(invalid)[:20]), self.assertRaises(probe.ProbeFailure):
                probe.hex_quantity(invalid)

    def test_json_rejects_duplicate_fields_and_nonfinite_numbers(self):
        for raw in (b'{"jsonrpc":"2.0","id":1,"result":0,"result":1}',
                    b'{"jsonrpc":"2.0","id":1,"result":NaN}'):
            with self.assertRaises(ValueError):
                probe.decode_json(raw)

    def test_reader_verifies_log_and_block_identity(self):
        with self.assertRaises(probe.ProbeFailure):
            probe.validate_logs([{"address":"0x" + "aa" * 20, "topics":["0x123"],
                                  "blockNumber":"0x9", "blockHash":"0x" + "ff" * 32,
                                  "transactionHash":"0x" + "aa" * 32, "logIndex":"0x0"}], 1, 9)
        with self.assertRaises(probe.ProbeFailure):
            probe.validate_fixed_hash({"number":"0x1", "hash":"0x" + "aa" * 32,
                                       "parentHash":"0x" + "ff" * 32}, "0x" + "bb" * 32)


class PublicationTests(unittest.TestCase):
    def test_report_uses_single_public_documentation_asset(self):
        destination = probe.REPORT.relative_to(probe.ROOT).as_posix()
        self.assertEqual(destination, "docs/public/deployment/rpc/capabilities.json")
        self.assertFalse((probe.ROOT / "notes/046_rpc_capability_report.json").exists())
        report = json.loads(probe.REPORT.read_text(encoding="utf-8"))
        self.assertEqual(report["schema"], 1)
        self.assertIn(report["state"], ("not_run", "complete"))

    def test_report_is_replaced_atomically_with_original_mode(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "report.json"
            target.write_bytes(b"old\n")
            target.chmod(0o600)
            probe.publish_atomic(target, b"new\n")
            self.assertEqual(target.read_bytes(), b"new\n")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(list(Path(folder).iterdir()), [target])

    def test_existing_symlink_is_rejected_without_changing_its_target(self):
        with tempfile.TemporaryDirectory() as folder:
            real = Path(folder) / "real.json"
            real.write_bytes(b"keep\n")
            alias = Path(folder) / "report.json"
            alias.symlink_to(real)
            with self.assertRaises(ValueError):
                probe.publish_atomic(alias, b"overwrite\n")
            self.assertEqual(real.read_bytes(), b"keep\n")

    def test_publisher_uses_pinned_container_and_writes_only_fixed_report(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "js/packages/cam-viewer/src/rpc-catalog.json"
            report_path = root / "docs/public/deployment/rpc/capabilities.json"
            source.parent.mkdir(parents=True)
            report_path.parent.mkdir(parents=True)
            source.write_text(json.dumps(sample_catalog()))
            report_path.write_text('{"state":"not_run"}\n')
            image_source = root / "compose/release/rpc.yml"
            image_source.parent.mkdir(parents=True)
            image_source.write_text(
                "    image: docker.io/library/python:3.13-alpine@sha256:" + "a" * 64 + "\n"
            )
            catalog, digest = probe.read_catalog(source)
            with patch.object(probe, "JsonRpc", FakeRpc), redirect_stderr(io.StringIO()):
                payload = probe.report_bytes(probe.probe_catalog(catalog, digest))

            observed_commands = []
            def subprocess_result(argv, **_kwargs):
                observed_commands.append(argv)
                if argv[0] == "git":
                    return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
                if "run" in argv:
                    return SimpleNamespace(returncode=0, stdout=payload, stderr=b"")
                if "rm" in argv:
                    return SimpleNamespace(returncode=1, stdout=b"", stderr=b"")
                raise AssertionError("Unexpected external action")

            with (patch.object(probe, "ROOT", root), patch.object(probe, "REPORT", report_path),
                  patch.object(probe, "CATALOG", source), patch.object(probe.subprocess, "run", side_effect=subprocess_result),
                  patch.dict(os.environ, {"CAM_DOCKER_ENDPOINT": "unix:///tmp/selected.sock"}),
                  redirect_stderr(io.StringIO()), patch("sys.stdout", new_callable=io.StringIO)):
                probe.publish_via_docker("unix:///tmp/selected.sock")

            report = json.loads(report_path.read_text())
            self.assertEqual(report["state"], "complete")
            self.assertEqual(report["summary"], {"networks": 2, "endpoints": 2,
                            "keyless": 1, "requires_api_key": 1, "chain_verified": 1})
            self.assertEqual([item.name for item in report_path.parent.iterdir()], [report_path.name])

            docker_run = observed_commands[1]
            self.assertEqual(docker_run[0], "docker")
            self.assertEqual(docker_run[docker_run.index("--host") + 1], "unix:///tmp/selected.sock")
            self.assertEqual(docker_run[docker_run.index("--pull") + 1], "missing")
            self.assertEqual(docker_run[docker_run.index("--network") + 1], "bridge")
            self.assertEqual(docker_run[docker_run.index("--user") + 1], "65534:65534")
            self.assertIn("--read-only", docker_run)
            self.assertEqual(docker_run[docker_run.index("--cap-drop") + 1], "ALL")
            self.assertIn("no-new-privileges:true", docker_run)
            self.assertTrue(docker_run[docker_run.index("--entrypoint") + 2].startswith("docker.io/library/python:3.13-alpine@sha256:"))
            mounts = [docker_run[index+1] for index, arg in enumerate(docker_run[:-1]) if arg == "--mount"]
            self.assertEqual(len(mounts), 2)
            self.assertTrue(all("readonly" in mount for mount in mounts))
            self.assertFalse(any("API_KEY" in arg or "private" in arg for arg in docker_run))

    def test_failed_docker_probe_does_not_overwrite_previous_report(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            catalog_path = root / "js/packages/cam-viewer/src/rpc-catalog.json"
            report_path = root / "docs/public/deployment/rpc/capabilities.json"
            catalog_path.parent.mkdir(parents=True)
            report_path.parent.mkdir(parents=True)
            catalog_path.write_text(json.dumps(sample_catalog()))
            report_path.write_bytes(b"previous verified probe\n")
            image_source = root / "compose/release/rpc.yml"
            image_source.parent.mkdir(parents=True)
            image_source.write_text("    image: docker.io/library/python:3.13-alpine@sha256:" + "b" * 64 + "\n")

            def failure(argv, **_kwargs):
                if argv[0] == "git":
                    return SimpleNamespace(returncode=0)
                if "run" in argv:
                    return SimpleNamespace(returncode=3, stdout=b"incomplete", stderr=b"provider secret not shown")
                return SimpleNamespace(returncode=1, stdout=b"", stderr=b"")

            with (patch.object(probe, "ROOT", root), patch.object(probe, "REPORT", report_path),
                  patch.object(probe, "CATALOG", catalog_path),
                  patch.object(probe.subprocess, "run", side_effect=failure),
                  patch.dict(os.environ, {"CAM_DOCKER_ENDPOINT": "unix:///tmp/selected.sock"})):
                with self.assertRaisesRegex(ValueError, "prior report retained"):
                    probe.publish_via_docker("unix:///tmp/selected.sock")
            self.assertEqual(report_path.read_bytes(), b"previous verified probe\n")

    def test_invalid_docker_endpoint_fails_before_contact(self):
        for endpoint in ("http://remote", "tcp://127.0.0.1:2375", "unix://relative", ""):
            with self.subTest(endpoint=endpoint), self.assertRaises(ValueError):
                probe.publish_via_docker(endpoint)


if __name__ == "__main__":
    unittest.main()
