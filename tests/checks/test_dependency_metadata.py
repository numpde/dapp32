from __future__ import annotations

import re
import tomllib
import unittest

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
LOCK_NAME_RE = re.compile(r'^name = "([^"]+)"$', re.MULTILINE)
LOCK_VERSION_RE = re.compile(r'^version = "([^"]+)"$', re.MULTILINE)
REMAPPING_RE = re.compile(r"^@openzeppelin-contracts-([^/=]+)/=dependencies/@openzeppelin-contracts-\1/$")
CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}  @openzeppelin-contracts-([^\s]+)$")
IMPORT_RE = re.compile(r'from\s+"(@openzeppelin-contracts-([^/"]+)/[^"]+)"')


class DependencyMetadataTest(unittest.TestCase):
    def test_openzeppelin_version_is_single_and_consistent(self) -> None:
        foundry_version = self.foundry_openzeppelin_version()
        lock_version = self.locked_openzeppelin_version()
        remapping_version = self.remapped_openzeppelin_version()
        checksum_version = self.checksummed_openzeppelin_version()
        installed_version = self.installed_openzeppelin_version()
        import_versions = self.imported_openzeppelin_versions()

        self.assertEqual(foundry_version, lock_version, "foundry.toml and soldeer.lock disagree")
        self.assertEqual(foundry_version, remapping_version, "foundry.toml and remappings.txt disagree")
        self.assertEqual(
            foundry_version,
            checksum_version,
            "foundry.toml and dependency-checksums.txt disagree",
        )
        self.assertEqual(foundry_version, installed_version, "foundry.toml and dependencies/ disagree")
        self.assertLessEqual(import_versions, {foundry_version})

    def foundry_openzeppelin_version(self) -> str:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
        dependencies = config.get("dependencies", {})
        self.assertEqual([OZ_PACKAGE], [name for name in dependencies if name == OZ_PACKAGE])
        version = dependencies[OZ_PACKAGE]["version"]
        self.assertIsInstance(version, str)
        return version

    def locked_openzeppelin_version(self) -> str:
        text = read_text(repo_path("soldeer.lock"))
        names = LOCK_NAME_RE.findall(text)
        versions = LOCK_VERSION_RE.findall(text)

        self.assertEqual([OZ_PACKAGE], [name for name in names if name == OZ_PACKAGE])
        self.assertEqual(len(names), len(versions), "soldeer.lock dependency records are malformed")
        records = dict(zip(names, versions, strict=True))
        return records[OZ_PACKAGE]

    def remapped_openzeppelin_version(self) -> str:
        versions = [
            match.group(1)
            for line in read_text(repo_path("remappings.txt")).splitlines()
            if (match := REMAPPING_RE.match(line))
        ]
        self.assertEqual(1, len(versions), "expected exactly one OpenZeppelin remapping")
        return versions[0]

    def checksummed_openzeppelin_version(self) -> str:
        versions = [
            match.group(1)
            for line in read_text(repo_path("dependency-checksums.txt")).splitlines()
            if (match := CHECKSUM_RE.match(line))
        ]
        self.assertEqual(1, len(versions), "expected exactly one OpenZeppelin checksum")
        return versions[0]

    def imported_openzeppelin_versions(self) -> set[str]:
        versions: set[str] = set()

        for path in iter_files("contracts/src", "contracts/test"):
            if path.suffix != ".sol":
                continue
            for import_path, version in IMPORT_RE.findall(read_text(path)):
                self.assertTrue(
                    import_path.startswith(f"{OZ_PACKAGE}-{version}/"),
                    f"{path}: malformed OpenZeppelin import {import_path}",
                )
                versions.add(version)

        self.assertTrue(versions, "expected first-party contracts to exercise the OpenZeppelin dependency")
        return versions

    def installed_openzeppelin_version(self) -> str:
        dependencies_dir = repo_path("dependencies")
        self.assertTrue(dependencies_dir.is_dir(), "dependencies/ is missing; run make deps")

        directories = [
            path.name
            for path in dependencies_dir.iterdir()
            if path.is_dir() and path.name.startswith(f"{OZ_PACKAGE}-")
        ]
        self.assertEqual(1, len(directories), "expected exactly one installed OpenZeppelin directory")

        prefix = f"{OZ_PACKAGE}-"
        return directories[0][len(prefix) :]
