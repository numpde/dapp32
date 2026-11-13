from __future__ import annotations

import re
from contextlib import contextmanager
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from urllib.parse import urlparse

from .common import ROOT, read_text, repo_path
from tools.json_policy import strict_json_loads

from .docker_test_support import docker_environment_fixture

setUpModule, tearDownModule = docker_environment_fixture()


NPM_REGISTRY_HOST = "registry.npmjs.org"
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
ROOT_OWNED_TOOLCHAIN_DEPENDENCIES = {"typescript"}
DEV_ONLY_DEPENDENCIES = {"@vitejs/plugin-react", "vite"}
# Overrides are exceptional: they pin a vulnerable transitive package until the
# owning direct dependency ships a fixed range. Keep the map small and reviewed.
SECURITY_OVERRIDES = {
    "postcss": "8.5.25",
    "ws": "8.21.0",
}
ROOT_WORKSPACES = [
    "packages/cam-protocol",
    "packages/cam-core",
    "packages/cam-evm-viem",
    "packages/cam-screen",
    "packages/cam-conformance",
    "packages/cam-viewer",
    "apps/cam-web",
]
ROOT_WORKSPACE_SCRIPTS = {
    "build:packages": "npm run build --workspace packages",
    "build:workspace": "npm run build --workspaces --if-present",
    "build:cam-conformance": "npm run build -w @cam/protocol && npm run build -w @cam/conformance",
    "test:cam-conformance": "npm run build:cam-conformance && npm test -w @cam/conformance",
    "test:workspace": "npm run build:workspace && npm test --workspaces --if-present && npm run test:scenario-tools",
    "test:scenario-tools": "tsc -p tools/pay-to-play-vouchers/tsconfig.json && tsc -p tools/pay-to-play-local-scenario/tsconfig.json && tsc -p tools/escrow-local-scenario/tsconfig.json && tsc -p tools/cam-publication-preflight/tsconfig.json && tsc -p tools/release-rehearsal/tsconfig.json && tsc -p tools/release-approval/tsconfig.json && node --test --experimental-strip-types tools/pay-to-play-vouchers/*.test.ts tools/pay-to-play-local-scenario/runner.test.ts tools/escrow-local-scenario/runner.test.ts tools/cam-publication-preflight/*.test.ts tools/release-rehearsal/*.test.ts tools/release-approval/*.test.ts && node --test tools/workspace-graph.test.mjs",
    "test:refund-tools": "tsc -p tools/pay-to-play-refunds/tsconfig.json && node --test --experimental-strip-types tools/pay-to-play-refunds/*.test.ts",
}
LIBRARY_PACKAGE_SCRIPTS = {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "npm run typecheck && node --test --experimental-strip-types test/*.test.ts",
}
APP_PACKAGE_SCRIPTS = {
    "dev": "vite --configLoader native",
    "test": "tsc -p tsconfig.test.json && node --test --experimental-strip-types test/*.test.*",
    "typecheck": "tsc -p tsconfig.json",
    "build": "npm run typecheck && vite build --configLoader native",
}
PACKAGE_LOCK_FILENAMES = {
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
}
# Workspace edges can appear in source, tests, or module config files. Generated
# output and installs are consumers of the graph, not authorities for it.
PACKAGE_IMPORT_SCAN_EXTENSIONS = {".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"}
PACKAGE_IMPORT_SCAN_IGNORED_DIRS = {"dist", "node_modules"}
STAGED_JS_TSCONFIG_RE = re.compile(r'copy_file_if_present "\$source_dir/(?P<name>tsconfig[^"]*\.json)"')
MODULE_SPECIFIER_RE = re.compile(
    r'(?:from\s+["\'](?P<from>[^"\']+)["\']|'
    r'import\s+["\'](?P<bare>[^"\']+)["\']|'
    r'import\s*\(\s*["\'](?P<dynamic>[^"\']+)["\']\s*\)|'
    r'\brequire\s*\(\s*["\'](?P<require>[^"\']+)["\']\s*\))'
)


class PackageInstallIdentityTest(unittest.TestCase):
    """Installed dependencies and format outputs must use the selected engine's host-owner mapping."""

    @contextmanager
    def lane_fixture(self, target: str, mapped: str, *, unwritable: bool):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("compose", "containers", "dapps", "docs", "js/apps", "js/packages",
                         "tests", "tools", "ops", "dapps/pay-to-play/src"):
                (root / name).mkdir(parents=True, exist_ok=True)
            (root / "js/package.json").write_text("{}\n")
            (root / "js/package-lock.json").write_text("{}\n")
            (root / "dapps/foundry.toml").write_text("[profile.default]\n")
            for name in ("soldeer.lock", "remappings.txt", "dependency-checksums.txt"):
                (root / "dapps" / name).write_text("fixture\n")
            shutil.copyfile(ROOT / "tools/compose_cleanup.sh", root / "tools/compose_cleanup.sh")
            shutil.copyfile(ROOT / "tools/docker_context.sh", root / "tools/docker_context.sh")
            # The real selector is independently checked by test_release_identity.
            # Here we check that its one result reaches every stage, not Docker's
            # informational rootless flag or the host numeric UID.
            (root / "tools/release_identity.sh").write_text(
                'release_select_container_identity() {\n'
                '  printf "map-probe\\n" >> "$TEST_EVENTS"\n'
                '  if [[ "$TEST_MAPPED_USER" == refused ]]; then return 2; fi\n'
                '  IFS=: read -r RELEASE_CONTAINER_UID RELEASE_CONTAINER_GID <<< "$TEST_MAPPED_USER"\n'
                '  export RELEASE_CONTAINER_UID RELEASE_CONTAINER_GID\n'
                '}\n'
            )
            events = root / "events"
            events.touch()
            delegate = root / "compose.sh"
            delegate.write_text(
                'printf "compose %s\\n" "$*" >> "$TEST_EVENTS"\n'
                'printf "compose-project=%s\\n" "$COMPOSE_PROJECT_NAME" >> "$TEST_EVENTS"\n'
            )
            if unwritable:
                # Permission errors must be detected before the networked stage.
                output = root / ("dapps/dependencies" if target == "dapps/deps/install"
                                 else "js/node_modules")
                output.mkdir()
                output.chmod(0o500)
            env = dict(os.environ, TEST_EVENTS=str(events), TEST_MAPPED_USER=mapped,
                       PATH=f"{ROOT / 'tests/fixtures/docker-context'}:{os.environ['PATH']}",
                       TRACE=os.devnull, ENDPOINT="unix:///tmp/context-fixture.sock", FAKE_MODE="",
                       DOCKER_DELEGATE=str(delegate))
            output_path = root / ("dapps/dependencies" if target == "dapps/deps/install"
                                  else "js/node_modules")
            try:
                yield root, env, events, output_path
            finally:
                if unwritable:
                    output.chmod(0o700)

    def run_lane(self, target: str, mapped: str, *, host_identity: bool, unwritable: bool, allow_update: bool):
        with self.lane_fixture(target, mapped, unwritable=unwritable) as (root, env, events, output_path):
            uid = str(os.getuid()) if host_identity else str(os.getuid() + 1)
            gid = str(os.getgid())
            result = subprocess.run(
                ["make", "--no-print-directory", "-f", str(ROOT / "Makefile"), target,
                 f"LOCAL_UID={uid}", f"LOCAL_GID={gid}", "DOCKER_CONTEXT=fixture",
                 f"ALLOW_UPDATE={int(allow_update)}"],
                cwd=root, env=env, capture_output=True, text=True, timeout=25,
            )
            calls = events.read_text().splitlines()
            return result, calls, output_path.exists()

    def test_each_dependency_stage_uses_one_measured_engine_identity(self):
        for mapped in (f"{os.getuid()}:{os.getgid()}", "0:0", "4321:5432"):
            for target, stages in (
                ("dapps/deps/install", ("soldeer-stage", "soldeer-verify-stage")),
                ("js/deps/install", ("package-stage",)),
            ):
                for update in (False, True):
                    with self.subTest(mapped=mapped, target=target, update=update):
                        result, calls, _ = self.run_lane(target, mapped, host_identity=True, unwritable=False, allow_update=update)
                        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                        self.assertEqual(1, calls.count("map-probe"), calls)
                        apply = "update" if update else "locked"
                        services = (*stages, f"{'soldeer' if target.startswith('dapps') else 'package'}-apply-{apply}")
                        if target.startswith("dapps"):
                            services = (*services, "soldeer-verify")
                        actual = [call for call in calls if " run " in call]
                        self.assertEqual(len(services), len(actual), actual)
                        project_values = [
                            call.removeprefix("compose-project=")
                            for call in calls if call.startswith("compose-project=")
                        ]
                        self.assertGreaterEqual(len(project_values), len(actual) + 1, project_values)
                        self.assertEqual(1, len(set(project_values)), project_values)
                        teardown = [call for call in calls if " down " in call]
                        self.assertEqual(1, len(teardown), teardown)
                        self.assertIn("--rmi local", teardown[0])
                        self.assertIn(f"--project-name {project_values[0]}", teardown[0])

                        expected_kind = "solidity" if target.startswith("dapps") else "package"
                        self.assertRegex(
                            project_values[0], rf"^dapp32-{expected_kind}-deps-[0-9a-f]{{20}}$"
                        )
                        for call, service in zip(actual, services):
                            self.assertTrue(call.endswith(f"--user {mapped} {service}"), call)
                        self.assertFalse(any(call.startswith("info ") for call in calls),
                                         "Docker rootless flag must not choose the writer identity")

    def test_competing_installs_cannot_enter_the_same_checkout(self):
        # The first Make process holds the lock while its fake Docker stage
        # is blocked. The second must not invoke Docker or tear down the first
        # process's project, even when it is a different dependency installer.
        pairs = (
            ("dapps/deps/install", "js/deps/install"),
            ("js/deps/install", "dapps/deps/install"),
            ("js/deps/install", "js/deps/install"),
        )
        for first_target, second_target in pairs:
            with self.subTest(first=first_target, second=second_target), self.lane_fixture(
                first_target, f"{os.getuid()}:{os.getgid()}", unwritable=False
            ) as (root, env, events, _):
                entered = root / "entered"
                released = root / "released"
                (root / "compose.sh").write_text(
                    'printf "compose %s\\n" "$*" >> "$TEST_EVENTS"\n'
                    'printf "compose-project=%s\\n" "$COMPOSE_PROJECT_NAME" >> "$TEST_EVENTS"\n'
                    'if [[ " $* " == *" soldeer-stage "* || " $* " == *" package-stage "* ]]; then\n'
                    '  touch "$CASE_ENTERED"\n'
                    '  for attempt in {1..1000}; do\n'
                    '    [[ -f "$CASE_RELEASED" ]] && break\n'
                    '    sleep .01\n'
                    '  done\n'
                    '  [[ -f "$CASE_RELEASED" ]] || exit 25\n'
                    'fi\n'
                )
                env.update(CASE_ENTERED=str(entered), CASE_RELEASED=str(released))
                common = [
                    "LOCAL_UID=" + str(os.getuid()),
                    "LOCAL_GID=" + str(os.getgid()),
                    "DOCKER_CONTEXT=fixture",
                    "ALLOW_UPDATE=0",
                ]
                command = lambda target: [
                    "make", "--no-print-directory", "-f", str(ROOT / "Makefile"), target, *common
                ]
                first = subprocess.Popen(command(first_target), cwd=root, env=env,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    deadline = time.monotonic() + 6
                    while not entered.exists() and first.poll() is None and time.monotonic() < deadline:
                        time.sleep(.01)
                    self.assertTrue(entered.exists(), "first installer never entered Docker stage")
                    previous_calls = events.read_text()
                    contender = subprocess.run(
                        command(second_target), cwd=root, env=env,
                        capture_output=True, text=True, timeout=12,
                    )
                    self.assertEqual(2, contender.returncode, contender.stdout + contender.stderr)
                    self.assertIn("Dependency install lock is busy.", contender.stderr)
                    self.assertEqual(previous_calls, events.read_text(),
                                     "contender must not call Docker or retire foreign resources")
                finally:
                    released.touch()
                    try:
                        stdout, stderr = first.communicate(timeout=20)
                    except subprocess.TimeoutExpired:
                        first.kill()
                        stdout, stderr = first.communicate()
                        self.fail("first installer did not complete after its stage was released")
                self.assertEqual(0, first.returncode, stdout + stderr)
                calls = events.read_text().splitlines()
                project_values = [
                    call.removeprefix("compose-project=")
                    for call in calls if call.startswith("compose-project=")
                ]
                self.assertEqual(1, len(set(project_values)), project_values)
                self.assertEqual(1, len([line for line in calls if " down " in line]), calls)

    def test_unresolved_cleanup_retains_inputs_and_primary_failure(self):
        for target in ("dapps/deps/install", "js/deps/install"):
            for apply_fails in (False, True):
                with self.subTest(target=target, apply_fails=apply_fails), self.lane_fixture(
                    target, f"{os.getuid()}:{os.getgid()}", unwritable=False
                ) as (root, env, events, _):
                    delegate = root / "compose.sh"
                    delegate.write_text(
                        'printf "compose %s\\n" "$*" >> "$TEST_EVENTS"\n'
                        'printf "compose-project=%s\\n" "$COMPOSE_PROJECT_NAME" >> "$TEST_EVENTS"\n'
                        'if [[ " $* " == *" down "* ]]; then exit 17; fi\n'
                        'if [[ "$TEST_FAIL_APPLY" == 1 ]]; then\n'
                        '  case " $* " in\n'
                        '    *" soldeer-apply-locked "*|*" package-apply-locked "*) exit 23 ;;\n'
                        '  esac\n'
                        'fi\n'
                    )
                    env["TEST_FAIL_APPLY"] = "1" if apply_fails else "0"
                    result = subprocess.run(
                        ["make", "--no-print-directory", "-f", str(ROOT / "Makefile"),
                         target, f"LOCAL_UID={os.getuid()}", f"LOCAL_GID={os.getgid()}",
                         "DOCKER_CONTEXT=fixture", "ALLOW_UPDATE=0"],
                        cwd=root, env=env, capture_output=True, text=True, timeout=25,
                    )
                    expected_error = 23 if apply_fails else 17
                    # GNU Make returns 2 for a failing recipe, but prints the
                    # original recipe exit status. Require both signals.
                    self.assertEqual(2, result.returncode, result.stdout + result.stderr)
                    self.assertIn(f"Error {expected_error}", result.stderr)
                    kind = "Solidity" if target.startswith("dapps") else "JavaScript"
                    self.assertIn(kind + " dependency cleanup incomplete", result.stderr)
                    calls = events.read_text().splitlines()
                    projects = [line.split("=", 1)[1] for line in calls
                                if line.startswith("compose-project=")]
                    self.assertEqual(1, len(set(projects)), projects)
                    self.assertIn(projects[0], result.stderr)
                    self.assertEqual(1, len([line for line in calls if " down " in line]), calls)
                    if target.startswith("js"):
                        match = re.search(r"Retained staging inputs: (/tmp/\S+)", result.stderr)
                        self.assertIsNotNone(match, result.stderr)
                        stage = Path(match.group(1))
                        self.assertTrue(stage.is_dir(), "failed cleanup must retain mounted inputs")
                        self.addCleanup(shutil.rmtree, stage)

    def test_missing_or_invalid_mapping_stops_before_install_or_output_creation(self):
        for mapped in ("refused", "bad:identity", "1000:", ":1000"):
            for target in ("dapps/deps/install", "js/deps/install"):
                with self.subTest(mapped=mapped, target=target):
                    result, calls, output_exists = self.run_lane(target, mapped, host_identity=True, unwritable=False, allow_update=False)
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(any(" run " in call for call in calls), calls)
                    self.assertFalse(output_exists, "failed mapping must not create output")

    def test_host_identity_override_is_not_a_container_mapping_override(self):
        for target in ("dapps/deps/install", "js/deps/install"):
            with self.subTest(target=target):
                result, calls, _ = self.run_lane(target, "0:0", host_identity=False, unwritable=False, allow_update=False)
                self.assertNotEqual(0, result.returncode)
                self.assertNotIn("map-probe", calls)
                self.assertFalse(any(" run " in call for call in calls), calls)

    def test_existing_unwritable_dependency_directory_fails_before_download(self):
        for target in ("dapps/deps/install", "js/deps/install"):
            with self.subTest(target=target):
                result, calls, _ = self.run_lane(target, "0:0", host_identity=True, unwritable=True, allow_update=False)
                self.assertNotEqual(0, result.returncode)
                self.assertFalse(any(" run " in call for call in calls), calls)

    def test_host_writable_formatters_use_the_measured_identity(self):
        for target, service in (("pay-to-play/format", "forge-fmt"), ("ops/format", "execution-format")):
            with self.subTest(target=target):
                result, calls, _ = self.run_lane(target, "0:0", host_identity=True, unwritable=False, allow_update=False)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(1, calls.count("map-probe"), calls)
                stages = [call for call in calls if " run " in call]
                self.assertEqual(1, len(stages), stages)
                self.assertIn("--user 0:0", stages[0])
                self.assertIn(service, stages[0])


class PackageMetadataTest(unittest.TestCase):
    def test_js_workspace_uses_one_lockfile_source(self) -> None:
        lockfiles = {
            path.relative_to(repo_path(".")).as_posix()
            for path in repo_path(".").rglob("*")
            if path.is_file()
            and path.name in PACKAGE_LOCK_FILENAMES
            and "node_modules" not in path.relative_to(repo_path(".")).parts
        }

        # The Docker dependency lane is built around npm's single workspace
        # lock. Additional lock formats would create a second dependency truth.
        self.assertEqual({"js/package-lock.json"}, lockfiles)

    def test_npm_policy_stays_in_compose(self) -> None:
        npmrc_files = {
            path.relative_to(repo_path(".")).as_posix()
            for path in repo_path(".").rglob(".npmrc")
            if "node_modules" not in path.relative_to(repo_path(".")).parts
        }

        # Registry/install policy belongs to the Docker dependency lane. A repo
        # .npmrc would silently change host npm behavior outside that boundary.
        self.assertEqual(set(), npmrc_files)

    def test_package_manifests_are_declared_workspace_members(self) -> None:
        package_manifests = {
            path
            for path in repo_path(".").rglob("package.json")
            if path.is_file() and "node_modules" not in path.relative_to(repo_path(".")).parts
        }

        # A stray package.json creates a second npm island: dependency metadata
        # the Docker lane will not stage, lock, or test as part of the single
        # JS workspace. Keep every package manifest in the workspace inventory.
        self.assertEqual(set(self.package_manifest_paths()), package_manifests)

    def test_root_js_tsconfigs_are_staged_for_offline_workspace_lanes(self) -> None:
        root_tsconfigs = {path.name for path in repo_path("js").glob("tsconfig*.json")}
        staged_tsconfigs = set(STAGED_JS_TSCONFIG_RE.findall(read_text(repo_path("containers/node-deps/stage-js-workspace"))))

        # Package/tool tsconfigs extend root configs inside the staged tmpfs
        # workspace. A new root config must be copied deliberately, or Docker
        # checks can pass on the host shape and fail in the offline lane.
        self.assertEqual(root_tsconfigs, staged_tsconfigs)

    def test_workspace_tests_match_package_script_discovery(self) -> None:
        nested_tests = []
        for workspace in ROOT_WORKSPACES:
            test_root = repo_path(f"js/{workspace}/test")
            if not test_root.exists():
                continue
            nested_tests.extend(
                path.relative_to(repo_path(".")).as_posix()
                for path in test_root.rglob("*.test.*")
                if path.parent != test_root
            )

        # Workspace package scripts deliberately run test/*.test.*. A nested
        # test file would look real in review but never execute in package-test.
        self.assertEqual([], nested_tests)

    def test_js_staging_rejects_ambiguous_roots(self) -> None:
        workspace_stager = read_text(repo_path("containers/node-deps/stage-js-workspace"))
        modules_stager = read_text(repo_path("containers/node-deps/stage-node-modules"))

        # These helpers mutate tmpfs workspaces inside the dependency boundary.
        # They must reject ambiguous roots themselves, not rely only on Compose
        # mount shape or on later child-path checks.
        self.assertIn('reject_symlink "$source_dir"', workspace_stager)
        self.assertIn('reject_symlink "$target_dir"', workspace_stager)
        self.assertIn('if [ -L "$target_dir" ]; then', modules_stager)
        self.assertIn('if [ -e "$target_dir" ] && [ ! -d "$target_dir" ]; then', modules_stager)

    def test_workspace_package_surface_is_explicit(self) -> None:
        root_manifest = self.read_manifest(repo_path("js/package.json"))
        # The root manifest is the npm graph contract consumed by Docker
        # staging. Keep inventory and execution posture deliberate.
        self.assertEqual(
            "cam-js-workspace",
            root_manifest.get("name"),
            "js/package.json: root package name is part of the lock identity",
        )
        self.assertEqual(
            True,
            root_manifest.get("private"),
            "js/package.json: root workspace must never be publishable",
        )
        self.assertEqual(
            "module",
            root_manifest.get("type"),
            "js/package.json: root workspace must stay ESM",
        )
        self.assertEqual(
            ROOT_WORKSPACES,
            root_manifest.get("workspaces"),
            "js/package.json: workspace inventory must stay explicit and reviewed",
        )
        self.assertEqual(
            ROOT_WORKSPACE_SCRIPTS,
            root_manifest.get("scripts"),
            "js/package.json: root scripts are Make/Compose workflow contracts and must be reviewed explicitly",
        )
        self.assertEqual(
            SECURITY_OVERRIDES,
            root_manifest.get("overrides"),
            "js/package.json: npm overrides must stay limited to reviewed transitive security pins",
        )

        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            with self.subTest(path=str(path)):
                self.assertEqual(True, manifest.get("private"), f"{path}: workspace package must stay private")
                self.assertEqual("module", manifest.get("type"), f"{path}: workspace package must be ESM")

                if path.parent.parent == repo_path("js/packages"):
                    # Framework libraries are consumed through their package
                    # root only. Keep internals unexported unless the protocol
                    # deliberately grows a new public surface.
                    self.assertEqual(False, manifest.get("sideEffects"), f"{path}: library package must declare sideEffects=false")
                    self.assertEqual(["dist"], manifest.get("files"), f"{path}: library package must publish only dist")
                    self.assertEqual(
                        LIBRARY_PACKAGE_SCRIPTS,
                        manifest.get("scripts"),
                        f"{path}: library scripts must typecheck before strip-types tests",
                    )
                    self.assertEqual({
                        ".": {
                            "types": "./dist/index.d.ts",
                            "default": "./dist/index.js",
                        },
                    }, manifest.get("exports"), f"{path}: library package must expose only the root entrypoint")
                elif path.parent.parent == repo_path("js/apps"):
                    self.assertNotIn("files", manifest, f"{path}: app package must not declare publish files")
                    self.assertNotIn("exports", manifest, f"{path}: app package must not expose a package API")
                    self.assertNotIn(
                        "sideEffects",
                        manifest,
                        f"{path}: app package metadata must not advertise library tree-shaking semantics",
                    )
                    self.assertEqual(
                        APP_PACKAGE_SCRIPTS,
                        manifest.get("scripts"),
                        f"{path}: app scripts must typecheck before build",
                    )
                else:
                    self.fail(f"{path}: JS workspaces must live under js/packages/ or js/apps/")

    def test_package_manifests_and_lockfile_use_pinned_registry_dependencies(self) -> None:
        workspace_names = self.workspace_package_names()

        for path in self.package_manifest_paths():
            manifest = self.read_manifest(path)
            for field in DEPENDENCY_FIELDS:
                dependencies = manifest.get(field)
                if dependencies is None:
                    continue

                self.assertIsInstance(dependencies, dict, f"{path}: {field} must be an object")

                for name, version in sorted(dependencies.items()):
                    with self.subTest(path=str(path), field=field, dependency=name):
                        self.assertIsInstance(version, str, f"{path}: {field}.{name} must be a string")
                        if field == "dependencies":
                            self.assertNotIn(
                                name,
                                DEV_ONLY_DEPENDENCIES,
                                f"{path}: dependencies.{name} is a build/dev tool; use devDependencies",
                            )
                        if path != repo_path("js/package.json"):
                            self.assertNotIn(
                                name,
                                ROOT_OWNED_TOOLCHAIN_DEPENDENCIES,
                                f"{path}: {field}.{name} belongs in js/package.json",
                            )
                        if name in workspace_names:
                            self.assertEqual(
                                workspace_names[name],
                                version,
                                f"{path}: {field}.{name} must match the local workspace package version",
                            )
                        else:
                            self.assertRegex(
                                version,
                                VERSION_RE,
                                f"{path}: {field}.{name} must use an exact version, not a range",
                            )

        lock_path = repo_path("js/package-lock.json")
        self.assertTrue(lock_path.is_file(), "js/package-lock.json must be committed")

        lock = self.read_manifest(lock_path)
        self.assertIn(lock.get("lockfileVersion"), {2, 3})

        packages = lock.get("packages")
        self.assertIsInstance(packages, dict, "package-lock.json: packages must be an object")
        workspace_lock_paths = self.workspace_lock_paths()
        for path, package in sorted(packages.items()):
            self.assertIsInstance(path, str, "package-lock.json package path must be a string")
            self.assertIsInstance(package, dict, f"package-lock.json: {path} must be an object")

            if path == "" or path in workspace_lock_paths:
                continue

            if package.get("link") is True:
                resolved = package.get("resolved")
                with self.subTest(path=path):
                    self.assertIsInstance(resolved, str, f"package-lock.json: {path}.resolved must be a string")
                    self.assertIn(resolved, workspace_lock_paths, f"package-lock.json: {path} must link to a workspace")
                continue

            resolved = package.get("resolved")
            with self.subTest(path=path):
                self.assertIsInstance(resolved, str, f"package-lock.json: {path}.resolved must be a string")
                parsed = urlparse(resolved)
                self.assertEqual("https", parsed.scheme, f"package-lock.json: {path} must resolve over https")
                self.assertEqual(NPM_REGISTRY_HOST, parsed.netloc, f"package-lock.json: {path} must use npm registry")
                self.assertTrue(
                    parsed.path.endswith(".tgz"),
                    f"package-lock.json: {path} must resolve to an npm tarball",
                )

                integrity = package.get("integrity")
                self.assertIsInstance(integrity, str, f"package-lock.json: {path} must include integrity")
                self.assertTrue(
                    integrity.startswith("sha512-"),
                    f"package-lock.json: {path} must use sha512 integrity",
                )

        for name, version in SECURITY_OVERRIDES.items():
            package_path = f"node_modules/{name}"
            package = packages.get(package_path)
            with self.subTest(path=package_path):
                self.assertIsInstance(package, dict, f"package-lock.json: {package_path} must resolve security override")
                self.assertEqual(version, package.get("version"), f"package-lock.json: {package_path} must match override")

    def test_package_lock_workspace_entries_match_manifests(self) -> None:
        lock_path = repo_path("js/package-lock.json")
        lock = self.read_manifest(lock_path)
        packages = lock.get("packages")
        self.assertIsInstance(packages, dict, "package-lock.json: packages must be an object")

        for path in self.package_manifest_paths():
            lock_key = self.workspace_manifest_lock_key(path)
            package = packages.get(lock_key)
            with self.subTest(path=str(path)):
                self.assertIsInstance(package, dict, f"package-lock.json: missing workspace entry for {lock_key}")
                manifest = self.read_manifest(path)
                if path == repo_path("js/package.json"):
                    self.assertEqual(
                        manifest.get("name"),
                        package.get("name"),
                        f"package-lock.json: {lock_key} name must mirror {path}",
                    )
                self.assertEqual(
                    self.locked_manifest_fields(manifest, path),
                    self.locked_manifest_fields(package, lock_path),
                    f"package-lock.json: {lock_key} manifest fields must mirror {path}",
                )

        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            package_name = manifest.get("name")
            self.assertIsInstance(package_name, str, f"{path}: package name must be a string")
            lock_key = self.workspace_manifest_lock_key(path)
            link_key = f"node_modules/{package_name}"
            link = packages.get(link_key)
            with self.subTest(path=link_key):
                self.assertIsInstance(link, dict, f"package-lock.json: missing workspace link for {package_name}")
                self.assertEqual(True, link.get("link"), f"package-lock.json: {link_key} must be a workspace link")
                self.assertEqual(lock_key, link.get("resolved"), f"package-lock.json: {link_key} must resolve to {lock_key}")

    def test_workspace_dependency_graph_matches_direct_imports(self) -> None:
        workspace_names = self.workspace_package_names()

        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            package_name = manifest.get("name")
            self.assertIsInstance(package_name, str, f"{path}: package name must be a string")

            declared: set[str] = set()
            for field in DEPENDENCY_FIELDS:
                dependencies = manifest.get(field)
                if dependencies is None:
                    continue
                self.assertIsInstance(dependencies, dict, f"{path}: {field} must be an object")
                declared.update(name for name in dependencies if name in workspace_names)

            imported = self.imported_workspace_packages(path.parent, workspace_names)
            imported.discard(package_name)

            # Local workspace deps are architecture edges, not install trivia.
            # Hoisted node_modules can mask stale or undeclared workspace edges.
            self.assertEqual(imported, declared, f"{path}: workspace deps must match direct workspace imports")

    def test_workspace_manifests_declare_direct_external_imports(self) -> None:
        workspace_names = self.workspace_package_names()

        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            declared: set[str] = set()
            for field in DEPENDENCY_FIELDS:
                dependencies = manifest.get(field)
                if dependencies is None:
                    continue
                self.assertIsInstance(dependencies, dict, f"{path}: {field} must be an object")
                declared.update(str(name) for name in dependencies)

            imported = self.imported_external_packages(path.parent, workspace_names)
            # npm workspace hoisting is an installation detail, not a package
            # contract. Direct third-party imports must be visible in the
            # workspace manifest that owns the importing source or test.
            self.assertEqual(imported, imported & declared, f"{path}: direct external imports must be declared")

    def test_runtime_source_external_imports_use_runtime_dependencies(self) -> None:
        workspace_names = self.workspace_package_names()

        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            dependencies = manifest.get("dependencies")
            if dependencies is None:
                dependencies = {}
            self.assertIsInstance(dependencies, dict, f"{path}: dependencies must be an object when present")
            imported = self.imported_external_packages_from_files(
                self.runtime_source_files(path.parent),
                workspace_names,
                self.package_name(path),
            )

            # Tests and config may use devDependencies. Runtime source cannot:
            # package consumers do not inherit this workspace's dev graph.
            self.assertEqual(imported, imported & set(dependencies), f"{path}: runtime source imports must be dependencies")

    def test_workspace_dependency_scanner_sees_common_module_forms(self) -> None:
        source = "\n".join([
            'import "@cam/protocol"',
            'import { parseCam } from "@cam/core"',
            'await import("@cam/screen")',
            'const viewer = require("@cam/viewer")',
        ])

        # The dependency graph check is an architecture check, not an ESM-only
        # lint. CommonJS config or support files must not hide workspace edges.
        self.assertEqual(
            [
                "@cam/protocol",
                "@cam/core",
                "@cam/screen",
                "@cam/viewer",
            ],
            [specifier for specifier, _line in self.module_specifiers(source)],
        )

    def package_manifest_paths(self) -> list[Path]:
        return [repo_path("js/package.json"), *self.workspace_manifest_paths()]

    def workspace_package_names(self) -> dict[str, str]:
        names: dict[str, str] = {}
        for path in self.workspace_manifest_paths():
            manifest = self.read_manifest(path)
            name = manifest.get("name")
            self.assertIsInstance(name, str, f"{path}: package name must be a string")
            self.assertNotIn(name, names, f"{path}: duplicate workspace package name: {name}")
            version = manifest.get("version")
            self.assertIsInstance(version, str, f"{path}: package version must be a string")
            self.assertRegex(version, VERSION_RE, f"{path}: package version must be exact")
            names[name] = version
        return names

    def read_manifest(self, path: Path) -> dict[str, object]:
        manifest = strict_json_loads(read_text(path))
        self.assertIsInstance(manifest, dict, f"{path}: package manifest must be a JSON object")
        return manifest

    def locked_manifest_fields(self, source: dict[str, object], path: Path) -> dict[str, object]:
        fields: dict[str, object] = {}
        for field in ("version", "workspaces"):
            value = source.get(field)
            if value is not None:
                fields[field] = value
        for field in DEPENDENCY_FIELDS:
            dependencies = source.get(field)
            if dependencies is None:
                continue
            self.assertIsInstance(dependencies, dict, f"{path}: {field} must be an object")
            fields[field] = dependencies
        return fields

    def workspace_manifest_lock_key(self, path: Path) -> str:
        if path == repo_path("js/package.json"):
            # npm stores the workspace root package at the empty package-lock key.
            return ""

        return path.parent.relative_to(repo_path("js")).as_posix()

    def workspace_lock_paths(self) -> set[str]:
        root = repo_path("js")
        return {
            manifest.parent.relative_to(root).as_posix()
            for manifest in self.package_manifest_paths()
            if manifest != repo_path("js/package.json")
        }

    def imported_workspace_packages(self, package_root: Path, workspace_names: dict[str, str]) -> set[str]:
        imported: set[str] = set()
        for path in self.package_import_scan_files(package_root):
            for specifier, _line_number in self.module_specifiers(read_text(path)):
                package_name = self.workspace_package_name_for_specifier(specifier, workspace_names)
                if package_name is not None:
                    imported.add(package_name)
        return imported

    def imported_external_packages(self, package_root: Path, workspace_names: dict[str, str]) -> set[str]:
        return self.imported_external_packages_from_files(
            self.package_import_scan_files(package_root),
            workspace_names,
            self.package_name(package_root / "package.json"),
        )

    def imported_external_packages_from_files(
        self,
        paths: list[Path],
        workspace_names: dict[str, str],
        package_name: str,
    ) -> set[str]:
        imported: set[str] = set()
        for path in paths:
            for specifier, _line_number in self.module_specifiers(read_text(path)):
                name = self.external_package_name_for_specifier(specifier, workspace_names, package_name)
                if name is not None:
                    imported.add(name)
        return imported

    def runtime_source_files(self, package_root: Path) -> list[Path]:
        source_root = package_root / "src"
        if not source_root.is_dir():
            return []
        return [
            path
            for path in self.package_import_scan_files(source_root)
            if path.suffix != ".d.ts"
        ]

    def package_import_scan_files(self, package_root: Path) -> list[Path]:
        paths: list[Path] = []
        for path in package_root.rglob("*"):
            if not path.is_file():
                continue
            relative_parts = path.relative_to(package_root).parts
            if PACKAGE_IMPORT_SCAN_IGNORED_DIRS.intersection(relative_parts[:-1]):
                continue
            if path.suffix not in PACKAGE_IMPORT_SCAN_EXTENSIONS:
                continue
            paths.append(path)
        return sorted(paths)

    def module_specifiers(self, text: str) -> list[tuple[str, int]]:
        specifiers: list[tuple[str, int]] = []
        for match in MODULE_SPECIFIER_RE.finditer(text):
            specifier = next(group for group in match.groups() if group is not None)
            specifiers.append((specifier, text.count("\n", 0, match.start()) + 1))

        return specifiers

    def workspace_package_name_for_specifier(
        self,
        specifier: str,
        workspace_names: dict[str, str],
    ) -> str | None:
        for name in sorted(workspace_names, key=len, reverse=True):
            if specifier == name or specifier.startswith(f"{name}/"):
                return name
        return None

    def external_package_name_for_specifier(
        self,
        specifier: str,
        workspace_names: dict[str, str],
        own_package_name: str,
    ) -> str | None:
        if specifier.startswith((".", "node:")):
            return None
        if specifier in sys.stdlib_module_names:
            return None
        if self.workspace_package_name_for_specifier(specifier, workspace_names) is not None:
            return None
        if specifier == own_package_name or specifier.startswith(f"{own_package_name}/"):
            return None
        if specifier.startswith("@"):
            parts = specifier.split("/")
            return "/".join(parts[:2]) if len(parts) >= 2 else specifier
        return specifier.split("/", 1)[0]

    def workspace_manifest_paths(self) -> list[Path]:
        root = repo_path("js")
        manifest = self.read_manifest(root / "package.json")
        workspaces = manifest.get("workspaces")
        self.assertIsInstance(workspaces, list, "js/package.json: workspaces must be an array")

        paths: list[Path] = []
        for workspace in workspaces:
            self.assertIsInstance(workspace, str, "js/package.json: workspace entries must be strings")
            self.assertFalse(workspace.startswith("/"), "js/package.json: workspaces must be relative")
            self.assertFalse(workspace.startswith("./"), "js/package.json: workspaces must not use ./ prefixes")
            self.assertFalse(workspace.startswith("../"), "js/package.json: workspaces must stay under js/")
            self.assertFalse(workspace.startswith("!"), "js/package.json: workspaces must be positive globs")
            self.assertNotIn("!", workspace, "js/package.json: workspaces must be positive globs")
            self.assertNotIn("**", workspace, "js/package.json: workspaces must be simple relative globs")
            self.assertNotIn("/../", workspace, "js/package.json: workspaces must stay under js/")
            self.assertFalse(workspace.endswith("/.."), "js/package.json: workspaces must stay under js/")
            matches = sorted(root.glob(f"{workspace}/package.json"))
            self.assertTrue(matches, f"js/package.json: workspace matched no package manifests: {workspace}")
            for match in matches:
                self.assertNotIn(match, paths, f"js/package.json: workspace matched package manifest more than once: {match}")
                paths.append(match)

        return paths

    def package_name(self, manifest_path: Path) -> str:
        package_name = self.read_manifest(manifest_path).get("name")
        self.assertIsInstance(package_name, str, f"{manifest_path}: package name must be a string")
        return package_name
