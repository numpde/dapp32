from __future__ import annotations

import os
import unittest
from unittest import mock

from .common import import_python_module_with_env, repo_path


class RpcProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.proxy = load_rpc_proxy_module()

    def test_validate_rpc_request_rejects_duplicate_json_keys(self) -> None:
        with self.assertRaisesRegex(
            self.proxy.RpcRequestMalformed,
            "duplicate object key: method",
        ):
            self.proxy.validate_rpc_request(
                b'{"jsonrpc":"2.0","method":"eth_sendRawTransaction","method":"eth_blockNumber"}',
                frozenset({"eth_blockNumber"}),
            )

    def test_validate_rpc_request_rejects_non_standard_json_constants(self) -> None:
        with self.assertRaisesRegex(
            self.proxy.RpcRequestMalformed,
            "non-standard JSON constant",
        ):
            self.proxy.validate_rpc_request(
                b'{"jsonrpc":"2.0","method":"eth_blockNumber","id":NaN}',
                frozenset({"eth_blockNumber"}),
            )

    def test_validate_rpc_request_allows_only_declared_methods(self) -> None:
        self.proxy.validate_rpc_request(
            b'{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}',
            frozenset({"eth_blockNumber"}),
        )

        with self.assertRaisesRegex(
            self.proxy.RpcMethodRejected,
            "method is not allowed",
        ):
            self.proxy.validate_rpc_request(
                b'{"jsonrpc":"2.0","method":"eth_sendRawTransaction","id":1}',
                frozenset({"eth_blockNumber"}),
            )

    def test_byte_limit_environment_values_are_bounded(self) -> None:
        with mock.patch.dict(os.environ, {
            "RPC_PROXY_MAX_REQUEST_BYTES": str(self.proxy.MAX_REQUEST_LIMIT_BYTES + 1),
        }):
            with self.assertRaisesRegex(RuntimeError, "no greater than"):
                self.proxy.required_bounded_positive_int_env(
                    "RPC_PROXY_MAX_REQUEST_BYTES",
                    self.proxy.MAX_REQUEST_LIMIT_BYTES,
                )


def load_rpc_proxy_module():
    return import_python_module_with_env(
        "rpc_proxy_under_test",
        repo_path("containers/rpc-proxy/rpc_proxy.py"),
        {
            "RPC_PROXY_HOST": "127.0.0.1",
            "RPC_PROXY_PORT": "8080",
            "RPC_UPSTREAM_FILE": "/tmp/rpc-url",
            "RPC_PROXY_MAX_REQUEST_BYTES": "1024",
            "RPC_PROXY_MAX_RESPONSE_BYTES": "1024",
            "RPC_PROXY_MAX_UPSTREAM_URL_BYTES": "1024",
            "RPC_PROXY_CONNECT_TIMEOUT_SECONDS": "1",
            "RPC_ALLOWED_METHODS": "eth_blockNumber",
        },
    )


if __name__ == "__main__":
    unittest.main()
