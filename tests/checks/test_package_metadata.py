from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse

from .common import read_text, repo_path
from tools.json_policy import strict_json_loads


NPM_REGISTRY_HOST = "registry.npmjs.org"
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
ROOT_OWNED_TOOLCHAIN_DEPENDENCIES = {"typescript"}
DEV_ONLY_DEPENDENCIES = {"@vitejs/plugin-react", "vite"}
# Overrides are exceptional: they pin a vulnerable transitive package until the
# owning direct dependency ships a fixed range. Keep the map small and reviewed.
SECURITY_OVERRIDES = {"ws": "8.21.0"}
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
    "build:workspace": "npm run build --workspaces --if-present",
    "build:cam-conformance": "npm run build -w @cam/protocol && npm run build -w @cam/conformance",
    "test:cam-conformance": "npm run build:cam-conformance && npm test -w @cam/conformance",
    "test:workspace": "npm run build:workspace && npm test --workspaces --if-present",
}
LIBRARY_PACKAGE_SCRIPTS = {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "npm run typecheck && node --test --experimental-strip-types test/*.test.ts",
}
APP_PACKAGE_SCRIPTS = {
    "dev": "vite --configLoader native",
    "test": "npm run typecheck && node --test --experimental-strip-types test/*.test.*",
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
