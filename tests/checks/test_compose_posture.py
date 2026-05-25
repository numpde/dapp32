from __future__ import annotations

import re
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

    def test_rendered_compose_helper_honors_docker_compose_abstraction(self) -> None:
        text = read_text(repo_path("tests/checks/common.py"))

        self.assertIn('shlex.split(render_env.get("DOCKER_COMPOSE", "docker compose"))', text)
        self.assertNotIn('["docker",', text)

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

    def test_package_dependency_stage_uses_manifest_input_and_filtered_egress(self) -> None:
        text = read_text(repo_path("compose/package-deps.yml"))

        self.assertIn("package-egress-proxy:", text)
        self.assertIn("context: ../containers/https-egress-proxy", text)
        self.assertIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS: registry.npmjs.org", text)
        self.assertIn("HTTPS_PROXY: http://package-egress-proxy:8080", text)
        self.assertIn("https_proxy: http://package-egress-proxy:8080", text)
        self.assertIn("${PACKAGE_INPUT_DIR:?missing_PACKAGE_INPUT_DIR}:/input:ro", text)
        self.assertIn("package_internal:", text)
        self.assertIn("package_egress:", text)
        self.assertIn("internal: true", text)
        self.assertNotIn("..:/work", text)
        self.assertNotIn("../package.json", text)
        self.assertNotIn("../packages:/input", text)
        self.assertNotIn("../:/input", text)

    def test_package_dependency_stage_disables_npm_lifecycle_scripts(self) -> None:
        text = read_text(repo_path("compose/package-deps.yml"))

        self.assertIn('npm_config_ignore_scripts: "true"', text)
        self.assertIn('npm_config_audit: "false"', text)
        self.assertIn('npm_config_fund: "false"', text)
        self.assertIn('npm_config_save_exact: "true"', text)
        self.assertIn("npm ci", text)
        self.assertIn("npm install", text)
        self.assertNotIn("--ignore-scripts", text)

    def test_package_dependency_apply_stages_are_offline(self) -> None:
        text = read_text(repo_path("compose/package-deps.yml"))

        self.assertIn("package-apply-locked:", text)
        self.assertIn("package-apply-update:", text)
        self.assertGreaterEqual(text.count('network_mode: "none"'), 2)
        self.assertIn("../packages/node_modules:/work/node_modules:rw", text)
        self.assertIn("../packages/package-lock.json:/work/package-lock.json:ro", text)
        self.assertIn("../packages/package-lock.json:/work/package-lock.json:rw", text)
        self.assertEqual(2, text.count('network_mode: "none"'))

    def test_package_dependency_apply_uses_shared_node_modules_stager(self) -> None:
        compose_text = read_text(repo_path("compose/package-deps.yml"))
        dockerfile_text = read_text(repo_path("containers/node-deps/Dockerfile"))
        dockerignore_text = read_text(repo_path("containers/node-deps/.dockerignore"))
        stager_text = read_text(repo_path("containers/node-deps/stage-node-modules"))

        self.assertIn("stage-node-modules /out/node_modules /work/node_modules", compose_text)
        self.assertNotIn("find /work/node_modules", compose_text)
        self.assertIn("COPY stage-node-modules /usr/local/bin/stage-node-modules", dockerfile_text)
        self.assertIn("chmod 1777 /out", dockerfile_text)
        self.assertEqual("**\n!Dockerfile\n!stage-node-modules\n", dockerignore_text)
        self.assertIn('"$source_dir" != "/out/node_modules"', stager_text)
        self.assertIn('"$target_dir" != "/work/node_modules"', stager_text)

    def test_package_dependency_make_target_precreates_bind_mount_targets(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn("reject_unsafe_package_targets()", text)
        self.assertGreaterEqual(text.count("reject_unsafe_package_targets"), 4)
        self.assertIn('[[ -L "$(PACKAGE_NODE_MODULES_DIR)" || -L "$(PACKAGE_LOCK_FILE)" ]]', text)
        self.assertIn('[[ -e "$(PACKAGE_NODE_MODULES_DIR)" && ! -d "$(PACKAGE_NODE_MODULES_DIR)" ]]', text)
        self.assertIn('[[ -e "$(PACKAGE_LOCK_FILE)" && ! -f "$(PACKAGE_LOCK_FILE)" ]]', text)
        self.assertIn('[[ -L "$(PACKAGE_MANIFEST_FILE)" ]]', text)
        self.assertIn('[[ -L "$$manifest" ]]', text)
        self.assertIn('mkdir -p "$(PACKAGE_NODE_MODULES_DIR)"', text)
        self.assertIn('test -d "$(PACKAGE_NODE_MODULES_DIR)"', text)
        self.assertIn('touch "$(PACKAGE_LOCK_FILE)"', text)
        self.assertIn('created_package_lock_placeholder=1', text)
        self.assertIn('rm -f "$(PACKAGE_LOCK_FILE)"', text)
        self.assertIn('test -f "$(PACKAGE_LOCK_FILE)"', text)
        self.assertIn("find $(PACKAGES_DIR) -mindepth 2 -maxdepth 2 -name package.json", text)

    def test_package_build_and_test_lanes_are_offline(self) -> None:
        text = read_text(repo_path("compose/packages.yml"))

        self.assertIn("package-graph-check:", text)
        self.assertIn("package-build:", text)
        self.assertIn("package-test:", text)
        self.assertIn("x-package-base: &package_base", text)
        self.assertGreaterEqual(text.count("<<: *package_base"), 3)
        self.assertEqual(1, text.count('network_mode: "none"'))
        self.assertEqual(1, text.count("read_only: true"))
        self.assertEqual(1, text.count("no-new-privileges:true"))
        self.assertEqual(1, text.count("- ALL"))
        self.assertIn("../packages:/work/packages:ro", text)
        self.assertNotIn("../packages:/work/packages:rw", text)
        for package_json in sorted(repo_path("packages").glob("*/package.json")):
            package_dir = package_json.parent.name
            self.assertIn(f"target: /work/packages/{package_dir}/dist", text)
            self.assertNotIn(f"../packages/{package_dir}/dist:", text)
        self.assertIn("working_dir: /work/packages", text)
        self.assertIn("npm", text)
        self.assertIn("ls", text)
        self.assertIn("--all", text)
        self.assertIn("--workspaces", text)
        self.assertIn("--ignore-scripts", text)
        self.assertIn("--offline", text)
        self.assertIn("--omit=optional", text)
        self.assertIn("--json >/tmp/package-graph-check.json", text)
        self.assertIn(
            "package-graph-check: installed npm dependency graph is consistent with package manifests and lock metadata",
            text,
        )
        self.assertNotIn("../:/work", text)
        self.assertNotIn("..:/work", text)
        self.assertNotIn("npm install", text)
        self.assertNotIn("npm ci", text)
        self.assertNotIn("HTTP_PROXY", text)
        self.assertNotIn("HTTPS_PROXY", text)

    def test_package_build_is_dist_artifact_lane_by_convention(self) -> None:
        for package_json in sorted(repo_path("packages").glob("*/package.json")):
            with self.subTest(package=str(package_json.relative_to(repo_path(".")))):
                package_text = read_text(package_json)
                tsconfig_text = read_text(package_json.parent / "tsconfig.json")

                self.assertIn('"build": "tsc -p tsconfig.json"', package_text)
                self.assertIn('"outDir": "dist"', tsconfig_text)
                self.assertIn('"rootDir": "src"', tsconfig_text)
                self.assertIn('"src/**/*.ts"', tsconfig_text)

    def test_package_build_test_and_viewer_targets_check_locked_graph(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn("PACKAGE_DEPS_GUARD :=", text)
        self.assertIn('[[ ! -d "$(PACKAGE_NODE_MODULES_DIR)" || ! -f "$(PACKAGE_LOCK_FILE)" ]]', text)
        self.assertIn("PACKAGE_MANIFEST_FILE := $(PACKAGES_DIR)/package.json", text)
        self.assertIn("Run make package-deps to install the locked package dependencies.", text)
        self.assertIn("define compose_run_with_package_deps", text)
        self.assertIn("package-graph-check:", text)
        self.assertIn("package-build: package-graph-check", text)
        self.assertNotIn("mkdir -p \"$${manifest%/package.json}/dist\"", text)
        self.assertIsNone(re.search(r"^package-build:\s+package-deps$", text, re.MULTILINE))
        self.assertIn("package-test: package-graph-check", text)
        self.assertIn("viewer-terminal-check: package-graph-check", text)
        self.assertIn("npm run build:packages", text)
        self.assertIn("./node_modules/.bin/tsc -p ../tools/viewer-terminal/tsconfig.json", text)
        self.assertIn("node --experimental-strip-types tools/viewer-terminal/terminal-session.ts", text)
        self.assertIn("viewer-terminal: package-graph-check", text)
        self.assertIn("$(call compose_run_with_package_deps,packages.yml,package-graph-check)", text)
        self.assertIn("$(call compose_run_with_package_deps,packages.yml,package-build)", text)
        self.assertIn("$(call compose_run_with_package_deps,packages.yml,package-test)", text)
        self.assertIn("VIEWER_TERMINAL_COMPOSE_PROJECT_NAME", text)
        self.assertIn("VIEWER_TERMINAL_CONTAINER_NAME", text)
        self.assertIn("$(PACKAGE_DEPS_GUARD)", text)
        self.assertIn("ci: fmt build script-build test fuzz invariant package-test viewer-terminal-check", text)

    def test_interactive_viewer_has_explicit_lifecycle_targets(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn("viewer-terminal-status:", text)
        self.assertIn("viewer-terminal-attach:", text)
        self.assertIn("viewer-terminal-down:", text)
        self.assertIn("VIEWER_TERMINAL_CONTAINER_NAME=$(VIEWER_TERMINAL_CONTAINER_NAME)", text)
        self.assertIn("ps --all --quiet viewer-terminal", text)
        self.assertIn("ps --all viewer-terminal", text)
        self.assertIn("attach viewer-terminal", text)
        self.assertIn("down --volumes --remove-orphans", text)
        self.assertNotIn("docker container inspect", text)
        self.assertNotIn("docker attach", text)
        self.assertNotIn("docker rm -f", text)
        self.assertNotIn("--name \"$(VIEWER_TERMINAL_CONTAINER_NAME)\"", text)

    def test_bike_nft_local_deploy_has_explicit_scenario_target(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn("BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME", text)
        self.assertIn("bike-nft-local-deploy: deps-verify", text)
        self.assertIn("BIKE_NFT_PRIVATE_KEY_FILE", text)
        self.assertIn("env -u PRIVATE_KEY", text)
        self.assertIn("bike-nft-local.yml", text)

    def test_live_dependency_egress_check_reuses_dependency_proxy_service(self) -> None:
        text = read_text(repo_path("compose/check-live-deps-egress.yml"))

        self.assertIn("egress-proxy-check:", text)
        self.assertIn("dependency-egress-proxy:", text)
        self.assertIn("condition: service_healthy", text)
        self.assertIn("- deps_internal", text)
        self.assertIn("../dapps/soldeer.lock:/input/soldeer.lock:ro", text)
        self.assertNotIn("context: ../containers/https-egress-proxy", text)
        self.assertNotIn("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS:", text)
        self.assertNotIn("DEPENDENCY_EGRESS_ALLOWED_HOST:", text)

    def test_check_target_names_are_layered_by_cost(self) -> None:
        text = read_text(repo_path("Makefile"))

        self.assertIn(".PHONY: help deps deps-verify package-deps package-graph-check package-build package-test viewer-terminal-check checks check-runtime check-live check-live-deps-egress", text)
        self.assertIn("check-runtime: check-anvil-compose", text)
        self.assertIn("check-live: check-live-deps-egress", text)
        self.assertIn("LIVE_DEPS_EGRESS_COMPOSE_FILES :=", text)
        self.assertIn("-f $(COMPOSE_DIR)/deps.yml -f $(COMPOSE_DIR)/check-live-deps-egress.yml", text)

    def test_dependency_verify_stage_applies_declared_patches(self) -> None:
        text = read_text(repo_path("compose/deps.yml"))
        foundry_deps_text = read_text(repo_path("containers/foundry-deps/Dockerfile"))
        python_deps_text = read_text(repo_path("containers/python-deps/Dockerfile"))

        self.assertIn("soldeer-verify-stage:", text)
        self.assertIn("context: ../containers/python-deps", text)
        self.assertIn("../dapps/dependency-patches.txt:/input/dependency-patches.txt:ro", text)
        self.assertIn("../dapps/_patches:/input/_patches:ro", text)
        self.assertIn("apply_dependency_patches", text)
        self.assertIn("--fuzz=0", text)
        self.assertIn("python3 -I -B /input/test_dependency_integrity.py --verify-upstream /out", text)
        self.assertNotIn("python3 -I -B /input/test_dependency_integrity.py --verify-upstream /tmp/soldeer-work", text)
        self.assertNotIn("apt-get install", foundry_deps_text)
        self.assertNotIn("python3.10", foundry_deps_text)
        self.assertIn("patch=2.8-r0", python_deps_text)

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

    def test_forge_lanes_discover_dapps_by_convention(self) -> None:
        text = read_text(repo_path("compose/forge.yml"))

        self.assertIn("for dir in */src */test */script", text)
        self.assertIn("for dir in */src", text)
        self.assertIn("for dir in */script", text)
        self.assertIn("forge-script-build:", text)
        self.assertIn("no dapp src/test/script directories found", text)
        self.assertIn("no dapp src directories found", text)
        self.assertNotIn("deposit/src", text)
        self.assertNotIn("deposit/test", text)
        self.assertNotIn("bike-nft/src", text)
        self.assertNotIn("minimal/src", text)

    def test_coverage_uses_unit_test_convention(self) -> None:
        text = read_text(repo_path("compose/forge.yml"))

        self.assertIn("forge-coverage:", text)
        self.assertIn("--match-path", text)
        self.assertIn("*/test/unit/**/*.sol", text)
