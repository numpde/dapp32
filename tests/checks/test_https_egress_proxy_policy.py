from __future__ import annotations

import importlib.util
import unittest

from .common import read_text, repo_path


def load_https_egress_proxy_module():
    path = repo_path("containers/https-egress-proxy/https_egress_proxy.py")
    spec = importlib.util.spec_from_file_location("https_egress_proxy", path)
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class HttpsEgressProxyPolicyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.proxy = load_https_egress_proxy_module()

    def test_proxy_host_allowlist_is_configured_for_dependency_lane(self) -> None:
        text = read_text(repo_path("compose/deps.yml"))

        self.assertIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: api.soldeer.xyz,soldeer-revisions.s3.amazonaws.com", text)
        self.assertNotIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: ''", text)
        self.assertNotIn('HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: ""', text)

    def test_proxy_host_allowlist_is_configured_for_package_dependency_lane(self) -> None:
        text = read_text(repo_path("compose/package-deps.yml"))

        self.assertIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: registry.npmjs.org", text)
        self.assertNotIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: ''", text)
        self.assertNotIn('HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: ""', text)

    def test_accepts_allowlisted_host(self) -> None:
        allowed = self.proxy.parse_allowed_hosts("api.soldeer.xyz,soldeer-revisions.s3.amazonaws.com")

        self.proxy.require_allowed_host("SOLDEER-REVISIONS.S3.AMAZONAWS.COM.", allowed)
        self.proxy.require_allowed_host("API.SOLDEER.XYZ.", allowed)

    def test_rejects_unlisted_host(self) -> None:
        allowed = self.proxy.parse_allowed_hosts("api.soldeer.xyz,soldeer-revisions.s3.amazonaws.com")

        with self.assertRaisesRegex(self.proxy.ProxyRejected, "not allowlisted"):
            self.proxy.require_allowed_host("example.com", allowed)

    def test_empty_allowlist_rejects_all_targets(self) -> None:
        with self.assertRaisesRegex(self.proxy.ProxyRejected, "allowlist is empty"):
            self.proxy.require_allowed_host("example.com", frozenset())

    def test_connect_target_normalizes_host_before_policy(self) -> None:
        host, port = self.proxy.parse_connect_target("SOLDEER-REVISIONS.S3.AMAZONAWS.COM.:443")

        self.assertEqual("soldeer-revisions.s3.amazonaws.com", host)
        self.assertEqual(443, port)
