from __future__ import annotations

from contextlib import contextmanager
import errno
import io
import os
import runpy
import tempfile
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

    def test_read_upstream_rejects_http_and_userinfo(self) -> None:
        with self.upstream_url("http://example.com/rpc"):
            with self.assertRaisesRegex(self.proxy.UpstreamRejected, "must use https"):
                self.proxy.read_upstream()

        with self.upstream_url("https://user:pass@example.com/rpc"):
            with self.assertRaisesRegex(self.proxy.UpstreamRejected, "must not include userinfo"):
                self.proxy.read_upstream()

    def test_read_upstream_preserves_https_path_and_query(self) -> None:
        with self.upstream_url("https://example.com/rpc?key=fixture"):
            self.assertEqual(
                self.proxy.read_upstream(),
                ("example.com", 443, "/rpc?key=fixture"),
            )

    def test_resolve_global_ip_rejects_private_addresses(self) -> None:
        with mock.patch.object(
            self.proxy.socket,
            "getaddrinfo",
            return_value=[(self.proxy.socket.AF_INET, None, None, "", ("10.0.0.2", 443))],
        ):
            with self.assertRaisesRegex(self.proxy.UpstreamRejected, "non-global address"):
                self.proxy.resolve_global_ip("example.com", 443)

    def test_proxy_failures_preserve_operation_and_reason_without_blaming_upstream(self) -> None:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as upstream:
            upstream.write("https://example.com/rpc")
            upstream.flush()
            for phase, code, reason in [("bind", errno.EADDRINUSE, "Address already in use"), ("serve", errno.EIO, "Input/output error")]:
                with self.subTest(phase=phase):
                    stderr = io.StringIO()
                    failure = OSError(code, reason)
                    with mock.patch.dict(os.environ, proxy_environment(upstream.name)), \
                            mock.patch("http.server.HTTPServer") as server, \
                            mock.patch("sys.stderr", stderr):
                        if phase == "bind":
                            server.side_effect = failure
                        else:
                            server.return_value.serve_forever.side_effect = failure
                        with self.assertRaises(SystemExit) as exited:
                            runpy.run_path(str(repo_path("containers/rpc-proxy/rpc_proxy.py")), run_name="__main__")
                    self.assertEqual(exited.exception.code, 2)
                    self.assertIs(exited.exception.__cause__, failure)
                    server.assert_called_once()
                    self.assertIn("could not run RPC proxy", stderr.getvalue())
                    self.assertIn("127.0.0.1:8080", stderr.getvalue())
                    self.assertIn(reason, stderr.getvalue())
                    self.assertNotIn("invalid upstream", stderr.getvalue())

    @contextmanager
    def upstream_url(self, value: str):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as handle:
            handle.write(value)
            handle.flush()
            with mock.patch.object(self.proxy, "UPSTREAM_FILE", handle.name):
                yield


def load_rpc_proxy_module():
    return import_python_module_with_env(
        "rpc_proxy_under_test",
        repo_path("containers/rpc-proxy/rpc_proxy.py"),
        proxy_environment("/tmp/rpc-url"),
    )


def proxy_environment(upstream_path: str):
    return {
        "RPC_PROXY_HOST": "127.0.0.1",
        "RPC_PROXY_PORT": "8080",
        "RPC_UPSTREAM_FILE": upstream_path,
        "RPC_PROXY_MAX_REQUEST_BYTES": "1024",
        "RPC_PROXY_MAX_RESPONSE_BYTES": "1024",
        "RPC_PROXY_MAX_UPSTREAM_URL_BYTES": "1024",
        "RPC_PROXY_CONNECT_TIMEOUT_SECONDS": "1",
        "RPC_ALLOWED_METHODS": "eth_blockNumber",
    }


if __name__ == "__main__":
    unittest.main()
