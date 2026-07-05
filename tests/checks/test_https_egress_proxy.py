from __future__ import annotations

import os
import unittest
from unittest import mock

from .common import import_python_module_with_env, repo_path


class HttpsEgressProxyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.proxy = load_https_egress_proxy_module()

    def test_byte_limit_environment_values_are_bounded(self) -> None:
        with mock.patch.dict(os.environ, {
            "HTTPS_EGRESS_PROXY_BUFFER_BYTES": str(self.proxy.MAX_TUNNEL_BUFFER_BYTES + 1),
        }):
            with self.assertRaisesRegex(RuntimeError, "no greater than"):
                self.proxy.required_bounded_positive_int_env(
                    "HTTPS_EGRESS_PROXY_BUFFER_BYTES",
                    self.proxy.MAX_TUNNEL_BUFFER_BYTES,
                )

    def test_allowed_hosts_are_normalized_for_exact_matching(self) -> None:
        hosts = self.proxy.parse_allowed_hosts("Registry.NPMJS.org., registry.npmjs.org")

        self.proxy.require_allowed_host("registry.npmjs.org.", hosts)
        with self.assertRaisesRegex(self.proxy.ProxyRejected, "not allowlisted"):
            self.proxy.require_allowed_host("registry.npmjs.org.evil.test", hosts)

    def test_connect_targets_must_be_host_port_without_http_syntax(self) -> None:
        with self.assertRaisesRegex(self.proxy.ProxyRejected, "must use port 443"):
            self.proxy.parse_connect_target("registry.npmjs.org:80")

        with self.assertRaisesRegex(self.proxy.ProxyRejected, "missing a host"):
            self.proxy.parse_connect_target(":443")

        with self.assertRaisesRegex(self.proxy.ProxyRejected, "invalid characters"):
            self.proxy.parse_connect_target("registry.npmjs.org\n:443")

    def test_resolve_global_addresses_rejects_private_dns_answers(self) -> None:
        with mock.patch.object(
            self.proxy.socket,
            "getaddrinfo",
            return_value=[(self.proxy.socket.AF_INET, None, None, "", ("192.168.1.10", 443))],
        ):
            with self.assertRaisesRegex(self.proxy.ProxyRejected, "non-global address"):
                self.proxy.resolve_global_addresses("registry.npmjs.org", 443)


def load_https_egress_proxy_module():
    return import_python_module_with_env(
        "https_egress_proxy_under_test",
        repo_path("containers/https-egress-proxy/https_egress_proxy.py"),
        {
            "HTTPS_EGRESS_PROXY_HOST": "127.0.0.1",
            "HTTPS_EGRESS_PROXY_PORT": "8080",
            "HTTPS_EGRESS_PROXY_CONNECT_TIMEOUT_SECONDS": "1",
            "HTTPS_EGRESS_PROXY_TUNNEL_IDLE_TIMEOUT_SECONDS": "1",
            "HTTPS_EGRESS_PROXY_MAX_HOST_BYTES": "255",
            "HTTPS_EGRESS_PROXY_BUFFER_BYTES": "65536",
            "HTTPS_EGRESS_PROXY_ALLOWED_HOSTS": "registry.npmjs.org",
        },
    )
