from __future__ import annotations

import unittest

from .common import iter_files, read_text, repo_path


class ComposePostureTest(unittest.TestCase):
    def test_compose_files_do_not_set_project_name(self) -> None:
        for path in iter_files("compose"):
            if path.suffix not in {".yml", ".yaml"}:
                continue

            with self.subTest(path=str(path)):
                for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                    if line.startswith("name:"):
                        self.fail(f"{path}:{line_number}: do not set Compose project name in checked-in YAML")

    def test_makefile_refuses_root_docker_lanes(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn("ACTUAL_UID := $(shell id -u)", text)
        self.assertIn('[[ "$(ACTUAL_UID)" == "0" || "$(LOCAL_UID)" == "0" ]]', text)
        self.assertIn("Refusing to run Docker lanes as root", text)

    def test_dependency_stage_uses_filtered_egress_proxy(self) -> None:
        text = read_text(repo_path("compose/deps.yml"))

        self.assertIn("dependency-egress-proxy:", text)
        self.assertIn("context: ../containers/https-egress-proxy", text)
        self.assertIn("HTTPS_PROXY: http://dependency-egress-proxy:8080", text)
        self.assertIn("https_proxy: http://dependency-egress-proxy:8080", text)
        self.assertIn("deps_internal:", text)
        self.assertIn("deps_egress:", text)
        self.assertIn("internal: true", text)

    def test_anvil_host_access_is_explicit_and_loopback_only(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        compose = read_text(repo_path("compose/anvil.yml"))

        self.assertIn("COMPOSE_PROFILES=internal", makefile)
        self.assertIn("COMPOSE_PROFILES=host", makefile)
        self.assertIn("profiles:\n      - internal", compose)
        self.assertIn("profiles:\n      - host", compose)
        self.assertIn("anvil_internal:\n    internal: true", compose)
        self.assertIn("anvil_host: {}", compose)
        self.assertIn('"127.0.0.1:${ANVIL_HOST_PORT:-8545}:8545"', compose)
        self.assertNotIn("0.0.0.0:${ANVIL_HOST_PORT", compose)
