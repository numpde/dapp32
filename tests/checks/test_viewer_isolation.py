"""Keep the opt-in portable viewer ingress narrower than its static content server."""

from __future__ import annotations

import re
import unittest

from .common import read_text, rendered_compose_config, repo_path


class ViewerIsolatedPostureTest(unittest.TestCase):
    def test_static_server_only_joins_the_internal_network(self) -> None:
        config = rendered_compose_config("compose/viewer-isolated.yml")
        self.assertEqual({"viewer", "viewer-ingress"}, set(config["services"]))
        self.assertTrue(config["networks"]["viewer_private"]["internal"])
        self.assertFalse(config["networks"]["viewer_ingress"]["internal"])

        static = config["services"]["viewer"]
        self.assertEqual({"viewer_private"}, set(static["networks"]))
        self.assertNotIn("ports", static)
        self.assertTrue(static["read_only"])
        self.assertEqual(["ALL"], static["cap_drop"])
        self.assertEqual("101:101", static["user"])
        self.assertNotIn("volumes", static)
        self.assertNotIn("secrets", static)
        self.assertEqual("never", static["pull_policy"])

    def test_only_unprivileged_ingress_publishes_the_host_port(self) -> None:
        config = rendered_compose_config("compose/viewer-isolated.yml")
        gateway = config["services"]["viewer-ingress"]
        self.assertEqual({"viewer_private", "viewer_ingress"}, set(gateway["networks"]))
        self.assertEqual(1, len(gateway["ports"]))
        self.assertEqual("127.0.0.1", gateway["ports"][0]["host_ip"])
        self.assertEqual("8080", str(gateway["ports"][0]["published"]))
        self.assertEqual(8080, gateway["ports"][0]["target"])
        self.assertEqual("service_healthy", gateway["depends_on"]["viewer"]["condition"])
        self.assertEqual("never", gateway["pull_policy"])
        self.assertEqual("101:101", gateway["user"])
        self.assertTrue(gateway["read_only"])
        self.assertEqual(["ALL"], gateway["cap_drop"])
        self.assertIn("no-new-privileges:true", gateway["security_opt"])
        for input_name in ("build", "volumes", "secrets", "privileged"):
            self.assertNotIn(input_name, gateway)
        configuration = " ".join(gateway["command"])
        self.assertIn("resolver 127.0.0.11", configuration)
        self.assertIn("proxy_pass http://$$viewer_backend:8080", configuration)
        self.assertNotIn("proxy_pass http://$host", configuration)

    def test_ingress_uses_existing_digest_pinned_nginx_not_an_additional_image(self) -> None:
        dockerfile = read_text(repo_path("containers/viewer/Dockerfile"))
        match = re.search(r"^FROM (\S+)$", dockerfile, re.MULTILINE)
        self.assertIsNotNone(match)
        config = rendered_compose_config("compose/viewer-isolated.yml")
        self.assertEqual(match.group(1), config["services"]["viewer-ingress"]["image"])

    def test_legacy_production_viewer_remains_single_container(self) -> None:
        config = rendered_compose_config("compose/viewer.yml")
        self.assertEqual({"viewer"}, set(config["services"]))
        self.assertEqual({"viewer"}, set(config["services"]["viewer"]["networks"]))
        self.assertEqual("127.0.0.1", config["services"]["viewer"]["ports"][0]["host_ip"])


if __name__ == "__main__":
    unittest.main()
