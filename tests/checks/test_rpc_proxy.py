from __future__ import annotations

from contextlib import contextmanager
import errno
import io
import os
import runpy
import ssl
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

    def test_positive_seconds_environment_values_remain_finite_and_positive(self) -> None:
        for value, expected in [("9", 9.0), ("0.125", 0.125)]:
            with self.subTest(value=value), mock.patch.dict(
                os.environ,
                {"RPC_PROXY_CONNECT_TIMEOUT_SECONDS": value},
            ):
                self.assertEqual(
                    self.proxy.required_positive_seconds_env("RPC_PROXY_CONNECT_TIMEOUT_SECONDS"),
                    expected,
                )

        for value in ["9" * 400, "0." + "0" * 400 + "1"]:
            with self.subTest(value=value[:8]), mock.patch.dict(
                os.environ,
                {"RPC_PROXY_CONNECT_TIMEOUT_SECONDS": value},
            ):
                with self.assertRaisesRegex(RuntimeError, "expected positive seconds"):
                    self.proxy.required_positive_seconds_env("RPC_PROXY_CONNECT_TIMEOUT_SECONDS")

    def test_invalid_seconds_environment_prevents_proxy_startup(self) -> None:
        for value in ["9" * 400, "0." + "0" * 400 + "1"]:
            with self.subTest(value=value[:8]), self.assertRaisesRegex(
                RuntimeError,
                "RPC_PROXY_CONNECT_TIMEOUT_SECONDS: expected positive seconds",
            ):
                import_python_module_with_env(
                    "rpc_proxy_invalid_timeout",
                    repo_path("containers/rpc-proxy/rpc_proxy.py"),
                    {
                        **proxy_environment("/tmp/rpc-url"),
                        "RPC_PROXY_CONNECT_TIMEOUT_SECONDS": value,
                    },
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

    def test_request_transport_failures_keep_public_response_generic_and_operator_cause_useful(self) -> None:
        tls_failure = ssl.SSLCertVerificationError(1, "opaque transport message fixture-secret")
        tls_failure.verify_code = 10
        tls_failure.verify_message = "certificate has expired"
        failures = [
            (ConnectionRefusedError(errno.ECONNREFUSED, os.strerror(errno.ECONNREFUSED), "https://example.com/private?token=fixture-secret"), "ConnectionRefusedError", "Connection refused"),
            (TimeoutError("opaque transport message fixture-secret"), "TimeoutError", "timed out"),
            (tls_failure, "SSLCertVerificationError", "certificate has expired"),
        ]
        body = b'{"jsonrpc":"2.0","method":"eth_blockNumber","id":"fixture-body-secret"}'
        request = b"POST / HTTP/1.0\r\nContent-Length: " + str(len(body)).encode() + b"\r\nAuthorization: Bearer fixture-header-secret\r\n\r\n" + body
        for failure, kind, reason in failures:
            with self.subTest(kind=kind):
                stderr = io.StringIO()
                connection = mock.Mock()
                connection.makefile.return_value = io.BytesIO(request)
                with self.upstream_url("https://example.com/private?token=fixture-secret"), \
                        mock.patch.object(self.proxy, "resolve_global_ip", return_value="93.184.216.34"), \
                        mock.patch.object(self.proxy, "FixedIpHttpsConnection") as transport, \
                        mock.patch("sys.stderr", stderr):
                    transport.return_value.request.side_effect = failure
                    self.proxy.Handler(connection, ("127.0.0.1", 1234), mock.Mock())
                response = b"".join(call.args[0] for call in connection.sendall.call_args_list).decode()
                self.assertIn("502", response)
                self.assertIn("RPC upstream request failed", response)
                self.assertNotIn(kind, response)
                diagnostic = stderr.getvalue()
                self.assertIn("RPC upstream request failed", diagnostic)
                self.assertIn(kind, diagnostic)
                self.assertIn(reason, diagnostic)
                self.assertEqual(len(diagnostic.splitlines()), 1)
                for secret in ["fixture-secret", "fixture-body-secret", "fixture-header-secret", "/private", "token="]:
                    self.assertNotIn(secret, response + diagnostic)
                transport.return_value.close.assert_called_once()

    @contextmanager
    def upstream_url(self, value: str):
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as handle:
            handle.write(value)
            handle.flush()
            with mock.patch.object(self.proxy, "UPSTREAM_FILE", handle.name):
                yield

    def test_alternate_upstream_preserves_shared_request_gates(self) -> None:
        transport = mock.Mock()
        transport.getresponse.return_value.status = 200
        transport.getresponse.return_value.reason = "OK"
        transport.getresponse.return_value.read.return_value = b'{"jsonrpc":"2.0","id":1,"result":"0x2"}'
        transport.getresponse.return_value.getheaders.return_value = [("content-type", "application/json")]
        upstream = mock.Mock(return_value=(transport, "/", "release-anvil"))

        class FixtureHandler(self.proxy.Handler):
            def open_upstream(self):
                return upstream()

        for method, status in (("eth_blockNumber", "200"), ("eth_sendRawTransaction", "403")):
            upstream.reset_mock()
            transport.reset_mock()
            body = ('{"jsonrpc":"2.0","id":1,"method":"' + method + '"}').encode()
            request = b"POST / HTTP/1.0\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
            connection = mock.Mock()
            connection.makefile.return_value = io.BytesIO(request)
            FixtureHandler(connection, ("127.0.0.1", 1234), mock.Mock())
            response = b"".join(call.args[0] for call in connection.sendall.call_args_list).decode()
            self.assertIn(status, response)
            if status == "200":
                upstream.assert_called_once_with()
                transport.close.assert_called_once_with()
            else:
                upstream.assert_not_called()


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
