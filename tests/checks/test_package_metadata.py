from __future__ import annotations

import re
import unittest
from pathlib import Path
from urllib.parse import urlparse

from .common import iter_files, read_text, repo_path
from tools.json_policy import strict_json_loads


NPM_REGISTRY_HOST = "registry.npmjs.org"
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
DEPENDENCY_FIELDS = ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies")
UNSUPPORTED_PACKAGE_MANAGER_FILES = (
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
)
PACKAGE_EXPORTS = {
    ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js",
    },
}
PACKAGE_SCRIPTS = {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.test.json",
    "test": "npm run typecheck && node --test --experimental-strip-types test/*.test.ts",
}


class PackageMetadataTest(unittest.TestCase):
    def test_npm_config_is_not_checked_in(self) -> None:
        npmrc_files = self.repo_files_named(".npmrc")

        self.assertEqual([], npmrc_files, "npm config belongs in compose/package-deps.yml, not checked-in .npmrc files")

    def test_package_lock_source_is_npm_package_lock_only(self) -> None:
        package_locks = self.repo_files_named("package-lock.json")
        allowed_lock = repo_path("packages/package-lock.json")
        self.assertLessEqual(set(package_locks), {allowed_lock}, "package-lock.json belongs only in packages/")
        for path in package_locks:
            with self.subTest(path=str(path)):
                self.assertFalse(path.is_symlink(), f"{path}: package lock must not be a symlink")

        unexpected_files = sorted(
            path
            for filename in UNSUPPORTED_PACKAGE_MANAGER_FILES
            for path in self.repo_files_named(filename)
        )

        self.assertEqual([], unexpected_files, "package-lock.json is the only supported package lock source")

    def test_packages_workspace_layout_matches_package_lane_convention(self) -> None:
        root_manifest = self.read_manifest(repo_path("packages/package.json"))

        self.assertIs(root_manifest["private"], True)
        workspaces = root_manifest["workspaces"]
        self.assertIsInstance(workspaces, list)
        self.assertTrue(all(isinstance(workspace, str) for workspace in workspaces))
        self.assertEqual(len(workspaces), len(set(workspaces)), "workspace entries must be unique")
        self.assertFalse(any("*" in workspace for workspace in workspaces), "workspace order must be explicit")

        package_dirs = [
            path.parent.name
            for path in self.package_manifest_paths()
            if path != repo_path("packages/package.json")
        ]
        self.assertEqual(set(package_dirs), set(workspaces))
        self.assertLess(
            workspaces.index("cam-protocol"),
            workspaces.index("cam-core"),
            "shared protocol support must build before packages that consume it",
        )

    def test_package_manifests_follow_workspace_layout(self) -> None:
        expected_paths = set(self.package_manifest_paths())
        actual_paths = {path for path in iter_files(".") if path.name == "package.json"}

        self.assertEqual(expected_paths, actual_paths)
        for path in sorted(actual_paths):
            with self.subTest(path=str(path)):
                self.assertFalse(path.is_symlink(), f"{path}: package manifests must not be symlinks")

    def test_package_exports_do_not_publish_internal_paths(self) -> None:
        for path in sorted(repo_path("packages").glob("*/package.json")):
            manifest = self.read_manifest(path)
            exports = manifest.get("exports")
            self.assertIsInstance(exports, dict, f"{path}: exports must be an object")

            for export_path in exports:
                with self.subTest(path=str(path), export_path=export_path):
                    self.assertIsInstance(export_path, str, f"{path}: export path must be a string")
                    self.assertNotIn("internal", export_path, f"{path}: internal modules must not be public exports")

    def test_workspace_packages_use_the_common_build_shape(self) -> None:
        package_tsconfig = self.read_manifest(repo_path("packages/tsconfig.package.json"))
        dom_tsconfig = self.read_manifest(repo_path("packages/tsconfig.dom.json"))
        dom_test_tsconfig = self.read_manifest(repo_path("packages/tsconfig.dom.test.json"))
        base_tsconfig = self.read_manifest(repo_path("packages/tsconfig.base.json"))
        compiler_options = package_tsconfig.get("compilerOptions")

        self.assertEqual("./tsconfig.base.json", package_tsconfig.get("extends"))
        self.assertIsInstance(compiler_options, dict, "packages/tsconfig.package.json: compilerOptions must be an object")
        self.assertEqual("${configDir}/dist", compiler_options.get("outDir"))
        self.assertEqual("${configDir}/src", compiler_options.get("rootDir"))
        self.assertEqual(["${configDir}/src/**/*.ts"], package_tsconfig.get("include"))
        self.assertEqual("./tsconfig.package.json", dom_tsconfig.get("extends"))
        self.assertEqual("./tsconfig.test.json", dom_test_tsconfig.get("extends"))
        self.assertEqual({"ES2022", "DOM"}, set(self.compiler_libs(dom_tsconfig, "packages/tsconfig.dom.json")))
        self.assertEqual({"ES2022", "DOM"}, set(self.compiler_libs(dom_test_tsconfig, "packages/tsconfig.dom.test.json")))

        base_options = base_tsconfig.get("compilerOptions")
        self.assertIsInstance(base_options, dict, "packages/tsconfig.base.json: compilerOptions must be an object")
        self.assertEqual("NodeNext", base_options.get("module"))
        self.assertIs(base_options.get("strict"), True)

        for path in sorted(repo_path("packages").glob("*/package.json")):
            manifest = self.read_manifest(path)
            with self.subTest(path=str(path)):
                self.assertIs(manifest.get("private"), True)
                self.assertEqual("module", manifest.get("type"))
                self.assertIs(manifest.get("sideEffects"), False)
                self.assertEqual(["dist"], manifest.get("files"))
                self.assertEqual(PACKAGE_EXPORTS, manifest.get("exports"))
                self.assertEqual(PACKAGE_SCRIPTS, manifest.get("scripts"))

                tsconfig = self.read_manifest(path.parent / "tsconfig.json")
                test_tsconfig = self.read_manifest(path.parent / "tsconfig.test.json")
                self.assertIn(tsconfig.get("extends"), {"../tsconfig.package.json", "../tsconfig.dom.json"})
                self.assertIn(test_tsconfig.get("extends"), {"../tsconfig.test.json", "../tsconfig.dom.test.json"})

    def test_package_tests_are_semantically_typechecked(self) -> None:
        self.assertTrue(repo_path("packages/tsconfig.test.json").is_file())
        stager = read_text(repo_path("containers/node-deps/stage-package-workspace"))
        self.assertIn('copy_file_if_present "$source_dir/tsconfig.test.json"', stager)
        self.assertIn('copy_file_if_present "$source_dir/tsconfig.dom.test.json"', stager)

        for path in sorted(repo_path("packages").glob("*/package.json")):
            manifest = self.read_manifest(path)
            scripts = manifest.get("scripts")
            self.assertIsInstance(scripts, dict, f"{path}: scripts must be an object")
            self.assertEqual(PACKAGE_SCRIPTS["typecheck"], scripts.get("typecheck"))
            self.assertEqual(PACKAGE_SCRIPTS["test"], scripts.get("test"))
            self.assertTrue((path.parent / "tsconfig.test.json").is_file(), f"{path.parent}: missing test tsconfig")

    def test_package_dependency_versions_are_exact(self) -> None:
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

    def test_package_dependency_version_policy_self_check(self) -> None:
        for version in ("1.2.3", "1.2.3-beta.1"):
            with self.subTest(version=version):
                self.assertRegex(version, VERSION_RE)

        for version in ("^1.2.3", "~1.2.3", ">=1.2.3", "latest", "git+https://example.test/pkg"):
            with self.subTest(version=version):
                self.assertNotRegex(version, VERSION_RE)

    def test_package_lock_uses_registry_sources_with_integrity(self) -> None:
        lock_path = repo_path("packages/package-lock.json")
        if not lock_path.exists():
            self.skipTest("package-lock.json has not been generated yet")

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

    def test_package_lock_source_policy_self_check(self) -> None:
        accepted = "https://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz"
        parsed = urlparse(accepted)
        self.assertEqual(("https", NPM_REGISTRY_HOST), (parsed.scheme, parsed.netloc))
        self.assertTrue(parsed.path.endswith(".tgz"))

        for url in (
            "http://registry.npmjs.org/typescript/-/typescript-6.0.3.tgz",
            "https://example.com/typescript.tgz",
            "https://registry.npmjs.org/typescript",
            "git+https://github.com/example/package.git",
            "file:../package.tgz",
        ):
            with self.subTest(url=url):
                parsed = urlparse(url)
                self.assertFalse(
                    (parsed.scheme, parsed.netloc) == ("https", NPM_REGISTRY_HOST)
                    and parsed.path.endswith(".tgz")
                )

    def package_manifest_paths(self) -> list[Path]:
        return [repo_path("packages/package.json"), *sorted(repo_path("packages").glob("*/package.json"))]

    def workspace_package_names(self) -> dict[str, str]:
        names: dict[str, str] = {}
        for path in sorted(repo_path("packages").glob("*/package.json")):
            manifest = self.read_manifest(path)
            name = manifest.get("name")
            self.assertIsInstance(name, str, f"{path}: package name must be a string")
            version = manifest.get("version")
            self.assertIsInstance(version, str, f"{path}: package version must be a string")
            self.assertRegex(version, VERSION_RE, f"{path}: package version must be exact")
            names[name] = version
        return names

    def read_manifest(self, path: Path) -> dict[str, object]:
        manifest = strict_json_loads(read_text(path))
        self.assertIsInstance(manifest, dict, f"{path}: package manifest must be a JSON object")
        return manifest

    def compiler_libs(self, manifest: dict[str, object], path: str) -> list[str]:
        compiler_options = manifest.get("compilerOptions")
        self.assertIsInstance(compiler_options, dict, f"{path}: compilerOptions must be an object")
        libs = compiler_options.get("lib")
        self.assertIsInstance(libs, list, f"{path}: compilerOptions.lib must be an array")
        self.assertTrue(all(isinstance(lib, str) for lib in libs), f"{path}: compilerOptions.lib must contain strings")
        return libs

    def repo_files_named(self, name: str) -> list[Path]:
        return [path for path in iter_files(".") if path.name == name]

    def workspace_lock_paths(self) -> set[str]:
        root = repo_path("packages")
        return {
            manifest.parent.relative_to(root).as_posix()
            for manifest in self.package_manifest_paths()
            if manifest != repo_path("packages/package.json")
        }
