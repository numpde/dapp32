from __future__ import annotations

import importlib.util
import os
import unittest

from .common import repo_path


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


def load_rpc_proxy_module():
    path = repo_path("containers/rpc-proxy/rpc_proxy.py")
    spec = importlib.util.spec_from_file_location("rpc_proxy_under_test", path)
    if spec is None or spec.loader is None:
        raise AssertionError(f"could not load {path}")

    module = importlib.util.module_from_spec(spec)
    old_environ = required_env_patch()
    try:
        spec.loader.exec_module(module)
    finally:
        old_environ.restore()
    return module


def required_env_patch() -> "_RequiredEnvPatch":
    env = _RequiredEnvPatch()
    env.set("RPC_PROXY_HOST", "127.0.0.1")
    env.set("RPC_PROXY_PORT", "8080")
    env.set("RPC_UPSTREAM_FILE", "/tmp/rpc-url")
    env.set("RPC_PROXY_MAX_REQUEST_BYTES", "1024")
    env.set("RPC_PROXY_MAX_RESPONSE_BYTES", "1024")
    env.set("RPC_PROXY_MAX_UPSTREAM_URL_BYTES", "1024")
    env.set("RPC_PROXY_CONNECT_TIMEOUT_SECONDS", "1")
    env.set("RPC_ALLOWED_METHODS", "eth_blockNumber")
    return env


class _RequiredEnvPatch:
    def __init__(self) -> None:
        self.old_values: dict[str, str | None] = {}

    def restore(self) -> None:
        for name, value in self.old_values.items():
            if value is None:
                if name in os.environ:
                    del os.environ[name]
            else:
                os.environ[name] = value

    def set(self, name: str, value: str) -> None:
        if name not in self.old_values:
            self.old_values[name] = os.environ.get(name)
        os.environ[name] = value


if __name__ == "__main__":
    unittest.main()
