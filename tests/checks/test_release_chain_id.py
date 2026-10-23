from __future__ import annotations

import contextlib
import io
import json
import unittest
from unittest.mock import Mock, patch

from tools import release_chain_id
from .common import rendered_compose_config


class ReleaseChainIdTest(unittest.TestCase):
    def invoke(self, status, body):
        response = Mock(status=status)
        response.read.return_value = body
        connection = Mock()
        connection.getresponse.return_value = response
        with patch.object(release_chain_id, "HTTPConnection", return_value=connection) as factory:
            output, errors = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                try:
                    release_chain_id.main()
                    code = 0
                except SystemExit as error:
                    code = error.code
        factory.assert_called_once_with("rpc-proxy", 8080, timeout=20)
        connection.close.assert_called_once()
        self.assertEqual("eth_chainId", json.loads(connection.request.call_args.kwargs["body"])["method"])
        return code, output.getvalue(), errors.getvalue(), response, connection

    def test_probe_prints_only_decimal_chain_id(self):
        code, output, errors, response, _ = self.invoke(200, b'{"jsonrpc":"2.0","id":1,"result":"0xa869"}')
        self.assertEqual((0, "43113\n", ""), (code, output, errors))
        response.read.assert_called_once_with(4097)

    def test_http_and_redirect_failures_never_read_or_follow_provider_content(self):
        secret = b"https://provider.test/v3/private-credential-token"
        for status in (301, 302, 307, 403, 429, 503):
            with self.subTest(status=status):
                code, output, errors, response, connection = self.invoke(status, secret)
                self.assertEqual(2, code)
                self.assertEqual("", output)
                self.assertIn(str(status), errors)
                self.assertNotIn(secret.decode(), errors)
                response.read.assert_not_called()
                self.assertEqual(1, connection.request.call_count)

    def test_json_rpc_error_and_malformed_responses_do_not_disclose_credentials(self):
        secret = "credential-bearing-provider-path"
        bodies = [
            json.dumps({"jsonrpc": "2.0", "id": 1, "error": {"code": -32001, "message": secret, "data": secret}}).encode(),
            f'{{"{secret}":'.encode(), b"\xff", b"x" * 4097,
            b'{"jsonrpc":"2.0","id":true,"result":"0xa869"}',
        ]
        for body in bodies:
            with self.subTest(body=body[:32]):
                code, output, errors, _, _ = self.invoke(200, body)
                self.assertEqual(2, code)
                self.assertEqual("", output)
                self.assertIn("eth_chainId", errors)
                self.assertNotIn(secret, errors)
                if b"-32001" in body:
                    self.assertIn("-32001", errors)

    def test_discovery_service_reads_only_through_proxy_and_has_no_key_or_source_mount(self):
        services = rendered_compose_config("compose/release/setup-rpc.yml")["services"]
        reader, proxy = services["rpc-chain-read"], services["rpc-proxy"]
        self.assertEqual("none", reader["logging"]["driver"])
        self.assertEqual({"rpc_internal"}, set(reader["networks"]))
        self.assertEqual({"/tool/release_chain_id.py"}, {mount["target"] for mount in reader["volumes"]})
        self.assertEqual("1000:1000", proxy["user"])
        self.assertEqual("eth_chainId", proxy["environment"]["RPC_ALLOWED_METHODS"])
        self.assertEqual("local", proxy["logging"]["driver"])
        self.assertEqual("64k", proxy["logging"]["options"]["max-size"])
        self.assertEqual("false", proxy["logging"]["options"]["compress"])
