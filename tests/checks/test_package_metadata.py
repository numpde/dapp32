from __future__ import annotations

import re
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
ROOT_WORKSPACE_SCRIPTS = {
    "build:workspace": "npm run build --workspaces --if-present",
    "build:cam-conformance": "npm run build -w @cam/protocol && npm run build -w @cam/core && npm run build -w @cam/screen && npm run build -w @cam/conformance",
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
STAGED_JS_TSCONFIG_RE = re.compile(r'copy_file_if_present "\$source_dir/(?P<name>tsconfig[^"]*\.json)"')


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

    def test_workspace_package_surface_is_explicit(self) -> None:
        root_manifest = self.read_manifest(repo_path("js/package.json"))
        self.assertEqual(
            ROOT_WORKSPACE_SCRIPTS,
            root_manifest.get("scripts"),
            "js/package.json: root scripts are Make/Compose workflow contracts and must be reviewed explicitly",
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

    def workspace_lock_paths(self) -> set[str]:
        root = repo_path("js")
        return {
            manifest.parent.relative_to(root).as_posix()
            for manifest in self.package_manifest_paths()
            if manifest != repo_path("js/package.json")
        }

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
