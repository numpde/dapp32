from __future__ import annotations

import re
import tomllib
import unittest
from urllib.parse import urlparse

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
OZ_PACKAGES = (OZ_PACKAGE,)
FORGE_STD_PACKAGE = "forge-std"
SOLDEER_REVISIONS_HOST = "soldeer-revisions.s3.amazonaws.com"
SOLDEER_ARCHIVE_SUFFIX_RE = {
    OZ_PACKAGE: r"contracts",
    FORGE_STD_PACKAGE: r"forge-std-[0-9]+(?:\.[0-9]+)*",
}
REMAPPING_RE = re.compile(
    r"^(?P<name>@openzeppelin-contracts(?:-upgradeable)?)-(?P<version>[^/=]+)/=dependencies/(?P=name)-(?P=version)/$"
)
CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}  (?P<name>@openzeppelin-contracts(?:-upgradeable)?)-(?P<version>[^\s]+)$")
IMPORT_RE = re.compile(r'["\'](?P<name>@openzeppelin-contracts(?:-upgradeable)?)-(?P<version>[^/"\']+)/')


class DependencyMetadataTest(unittest.TestCase):
    def test_soldeer_dependencies_use_registry_sources_and_consistent_openzeppelin_versions(self) -> None:
        foundry_dependencies = self.foundry_dependencies()
        lock_records = self.locked_dependency_records()

        self.assertEqual(set(foundry_dependencies), set(lock_records), "foundry.toml and soldeer.lock disagree")

        for name, dependency in sorted(foundry_dependencies.items()):
            with self.subTest(dependency=name):
                version = self.assert_registry_version_only_dependency(name, dependency)

                record = lock_records[name]
                self.assertEqual(
                    version,
                    record["version"],
                    f"{name} version differs between foundry.toml and soldeer.lock",
                )
                self.assert_allowed_soldeer_registry_url(name, record["url"], version)

        foundry_versions = {name: self.foundry_dependency_version(name) for name in OZ_PACKAGES}
        lock_versions = {name: self.locked_dependency_version(name) for name in OZ_PACKAGES}
        remapping_versions = self.remapped_openzeppelin_versions()
        checksum_versions = self.checksummed_openzeppelin_versions()
        import_versions = self.imported_openzeppelin_versions()

        for name in OZ_PACKAGES:
            with self.subTest(dependency=name):
                self.assertEqual(foundry_versions[name], lock_versions[name], "foundry.toml and soldeer.lock disagree")
                self.assertEqual(
                    foundry_versions[name],
                    remapping_versions.get(name),
                    "foundry.toml and remappings.txt disagree",
                )
                self.assertEqual(
                    foundry_versions[name],
                    checksum_versions.get(name),
                    "foundry.toml and dependency-checksums.txt disagree",
                )
                self.assertLessEqual(import_versions.get(name, set()), {foundry_versions[name]})

    def foundry_dependency_version(self, name: str) -> str:
        dependency = self.foundry_dependencies()[name]
        version = dependency["version"]
        self.assertIsInstance(version, str)
        return version

    def foundry_dependencies(self) -> dict[str, dict[str, object]]:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        dependencies = config.get("dependencies")
        self.assertIsInstance(dependencies, dict, "foundry.toml must declare [dependencies]")
        for name in OZ_PACKAGES:
            self.assertIn(name, dependencies, f"expected {name} dependency in foundry.toml")

        parsed: dict[str, dict[str, object]] = {}
        for name, dependency in dependencies.items():
            self.assertIsInstance(name, str)
            self.assertIsInstance(dependency, dict, f"{name} dependency must be a table")
            parsed[name] = dependency

        return parsed

    def locked_dependency_version(self, name: str) -> str:
        return self.locked_dependency_records()[name]["version"]

    def locked_dependency_records(self) -> dict[str, dict[str, str]]:
        lock = tomllib.loads(read_text(repo_path("dapps/soldeer.lock")))
        raw_records = lock.get("dependencies")
        self.assertIsInstance(raw_records, list, "soldeer.lock must declare dependencies")

        records: dict[str, dict[str, str]] = {}
        for raw_record in raw_records:
            self.assertIsInstance(raw_record, dict, "soldeer.lock dependency records must be tables")
            name = raw_record.get("name")
            self.assertIsInstance(name, str, "soldeer.lock dependency record missing name")
            self.assertNotIn(name, records, f"duplicate dependency record in soldeer.lock: {name}")

            record: dict[str, str] = {}
            for key in ("version", "url"):
                value = raw_record.get(key)
                self.assertIsInstance(value, str, f"{name} lock record missing {key}")
                record[key] = value

            records[name] = record

        for name in OZ_PACKAGES:
            self.assertIn(name, records, f"expected {name} dependency in soldeer.lock")
        return records

    def assert_registry_version_only_dependency(self, name: str, dependency: dict[str, object]) -> str:
        self.assertEqual(
            {"version"},
            set(dependency),
            f"{name} must be declared as a Soldeer registry version only, without custom url metadata",
        )
        version = dependency["version"]
        self.assertIsInstance(version, str, f"{name} dependency version must be a string")
        return version

    def assert_allowed_soldeer_registry_url(self, name: str, url: str, version: str) -> None:
        parsed = urlparse(url)
        expected_version_prefix = version.replace(".", "_")

        self.assertEqual("https", parsed.scheme, f"{name} lock URL must use https: {url}")
        self.assertEqual(SOLDEER_REVISIONS_HOST, parsed.netloc, f"{name} lock URL must use Soldeer revisions: {url}")
        self.assertRegex(
            parsed.path,
            rf"^/{re.escape(name)}/{re.escape(expected_version_prefix)}_[^/]+_{self.allowed_archive_suffix_re(name)}\.zip$",
            f"{name} lock URL must point to an allowed Soldeer archive: {url}",
        )

    def allowed_archive_suffix_re(self, name: str) -> str:
        self.assertIn(name, SOLDEER_ARCHIVE_SUFFIX_RE, f"{name} must have an explicit archive suffix policy")
        return SOLDEER_ARCHIVE_SUFFIX_RE[name]

    def remapped_openzeppelin_versions(self) -> dict[str, str]:
        versions = {
            match.group("name"): match.group("version")
            for line in read_text(repo_path("dapps/remappings.txt")).splitlines()
            if (match := REMAPPING_RE.match(line))
        }
        self.assertEqual(set(OZ_PACKAGES), set(versions), "expected exactly one remapping for each OpenZeppelin package")
        return versions

    def checksummed_openzeppelin_versions(self) -> dict[str, str]:
        versions = {
            match.group("name"): match.group("version")
            for line in read_text(repo_path("dapps/dependency-checksums.txt")).splitlines()
            if (match := CHECKSUM_RE.match(line))
        }
        self.assertEqual(set(OZ_PACKAGES), set(versions), "expected exactly one checksum for each OpenZeppelin package")
        return versions

    def imported_openzeppelin_versions(self) -> dict[str, set[str]]:
        versions: dict[str, set[str]] = {name: set() for name in OZ_PACKAGES}

        for path in iter_files("dapps"):
            if path.suffix != ".sol":
                continue
            for match in IMPORT_RE.finditer(read_text(path)):
                name = match.group("name")
                version = match.group("version")
                self.assertTrue(
                    name in OZ_PACKAGES,
                    f"{path}: malformed OpenZeppelin import {match.group(0)}",
                )
                versions[name].add(version)

        for name in OZ_PACKAGES:
            self.assertTrue(versions[name], f"expected first-party contracts to exercise {name}")
        return versions
