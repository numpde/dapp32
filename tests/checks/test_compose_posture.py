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
        self.assertIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: api.soldeer.xyz,soldeer-revisions.s3.amazonaws.com", text)
        self.assertIn("HTTPS_PROXY: http://dependency-egress-proxy:8080", text)
        self.assertIn("https_proxy: http://dependency-egress-proxy:8080", text)
        self.assertIn("deps_internal:", text)
        self.assertIn("deps_egress:", text)
        self.assertIn("internal: true", text)

    def test_live_dependency_egress_check_reuses_dependency_proxy_service(self) -> None:
        text = read_text(repo_path("compose/check-live-deps-egress.yml"))

        self.assertIn("egress-proxy-check:", text)
        self.assertIn("dependency-egress-proxy:", text)
        self.assertIn("condition: service_healthy", text)
        self.assertIn("- deps_internal", text)
        self.assertIn("../on-chain/soldeer.lock:/input/soldeer.lock:ro", text)
        self.assertNotIn("context: ../containers/https-egress-proxy", text)
        self.assertNotIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS:", text)
        self.assertNotIn("DEPENDENCY_EGRESS_ALLOWED_HOST:", text)

    def test_check_target_names_are_layered_by_cost(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn(".PHONY: help deps deps-verify checks check-runtime check-live check-live-deps-egress", text)
        self.assertIn("check-runtime: check-anvil-compose", text)
        self.assertIn("check-live: check-live-deps-egress", text)
        self.assertIn("LIVE_DEPS_EGRESS_COMPOSE_FILES :=", text)
        self.assertIn("-f $(COMPOSE_DIR)/deps.yml -f $(COMPOSE_DIR)/check-live-deps-egress.yml", text)

    def test_dependency_stage_applies_declared_patches(self) -> None:
        text = read_text(repo_path("compose/deps.yml"))

        self.assertIn("../on-chain/dependency-patches.txt:/input/dependency-patches.txt:ro", text)
        self.assertIn("../on-chain/dependency-patches.txt:/work/dependency-patches.txt:ro", text)
        self.assertIn("../on-chain/patches:/input/patches:ro", text)
        self.assertIn("../on-chain/patches:/work/patches:ro", text)
        self.assertIn("apply_dependency_patches", text)
        self.assertIn("--fuzz=0", text)

    def test_dependency_apply_stages_tree_before_replacement(self) -> None:
        text = read_text(repo_path("compose/deps.yml"))

        self.assertIn("stage_dependency_tree", text)
        self.assertIn("/work/dependencies/.next", text)
        self.assertIn("cp -a /out/dependencies/. /work/dependencies/.next/", text)
        direct_copy_lines = [
            line
            for line in text.splitlines()
            if line.strip() == "cp -a /out/dependencies/. /work/dependencies/"
        ]
        self.assertEqual([], direct_copy_lines)
