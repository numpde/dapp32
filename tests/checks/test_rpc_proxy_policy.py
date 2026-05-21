from __future__ import annotations

import importlib.util
import json
import unittest

from .common import read_text, repo_path


def load_rpc_proxy_module():
    path = repo_path("containers/rpc-proxy/rpc_proxy.py")
    spec = importlib.util.spec_from_file_location("rpc_proxy", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RpcProxyPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rpc_proxy = load_rpc_proxy_module()

    def test_cast_rpc_lane_sets_narrow_rpc_allowlist(self) -> None:
        text = read_text(repo_path("compose/cast.yml"))

        self.assertIn("RPC_ALLOWED_METHODS: eth_blockNumber", text)
        self.assertNotIn("eth_sendRawTransaction", text)
        self.assertNotIn("eth_sendTransaction", text)

    def test_rpc_proxy_accepts_allowed_single_request(self) -> None:
        self.rpc_proxy.validate_rpc_request(
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []}).encode(),
            {"eth_blockNumber"},
        )

    def test_rpc_proxy_rejects_disallowed_single_request(self) -> None:
        with self.assertRaises(self.rpc_proxy.RpcMethodRejected):
            self.rpc_proxy.validate_rpc_request(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "eth_sendRawTransaction",
                        "params": ["0x00"],
                    }
                ).encode(),
                {"eth_blockNumber"},
            )

    def test_rpc_proxy_rejects_mixed_batch_request(self) -> None:
        with self.assertRaises(self.rpc_proxy.RpcMethodRejected):
            self.rpc_proxy.validate_rpc_request(
                json.dumps(
                    [
                        {"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []},
                        {
                            "jsonrpc": "2.0",
                            "id": 2,
                            "method": "debug_traceTransaction",
                            "params": ["0x00"],
                        },
                    ]
                ).encode(),
                {"eth_blockNumber"},
            )

    def test_rpc_proxy_rejects_malformed_requests(self) -> None:
        malformed_bodies = [
            b"{",
            b"[]",
            b'"eth_blockNumber"',
            json.dumps({"jsonrpc": "2.0", "id": 1, "params": []}).encode(),
            json.dumps([{"jsonrpc": "2.0", "id": 1, "method": ""}]).encode(),
        ]

        for body in malformed_bodies:
            with self.subTest(body=body):
                with self.assertRaises(self.rpc_proxy.RpcRequestMalformed):
                    self.rpc_proxy.validate_rpc_request(body, {"eth_blockNumber"})

    def test_rpc_proxy_rejects_empty_allowlist(self) -> None:
        with self.assertRaises(self.rpc_proxy.RpcMethodRejected):
            self.rpc_proxy.validate_rpc_request(
                json.dumps({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber"}).encode(),
                set(),
            )
