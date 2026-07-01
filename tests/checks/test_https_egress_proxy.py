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
