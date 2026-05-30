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


class PackageMetadataTest(unittest.TestCase):
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

    def package_manifest_paths(self) -> list[Path]:
        return [repo_path("js/package.json"), *self.workspace_manifest_paths()]

    def workspace_package_names(self) -> dict[str, str]:
        names: dict[str, str] = {}
        for path in self.workspace_manifest_paths():
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
            paths.extend(matches)

        return paths
