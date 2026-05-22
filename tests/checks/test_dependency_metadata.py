from __future__ import annotations

import re
import tomllib
import unittest
from urllib.parse import urlparse

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
FORGE_STD_PACKAGE = "forge-std"
SOLDEER_REVISIONS_HOST = "soldeer-revisions.s3.amazonaws.com"
SOLDEER_ARCHIVE_SUFFIX_RE = {
    OZ_PACKAGE: r"contracts",
    FORGE_STD_PACKAGE: r"forge-std-[0-9]+(?:\.[0-9]+)*",
}
DEFAULT_SOLDEER_ARCHIVE_SUFFIX_RE = r"[A-Za-z0-9_.:-]+"
REMAPPING_RE = re.compile(r"^@openzeppelin-contracts-([^/=]+)/=dependencies/@openzeppelin-contracts-\1/$")
CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}  @openzeppelin-contracts-([^\s]+)$")
IMPORT_RE = re.compile(r'from\s+"(@openzeppelin-contracts-([^/"]+)/[^"]+)"')


class DependencyMetadataTest(unittest.TestCase):
    def test_openzeppelin_version_is_single_and_consistent(self) -> None:
        foundry_version = self.foundry_openzeppelin_version()
        lock_version = self.locked_openzeppelin_version()
        remapping_version = self.remapped_openzeppelin_version()
        checksum_version = self.checksummed_openzeppelin_version()
        import_versions = self.imported_openzeppelin_versions()

        self.assertEqual(foundry_version, lock_version, "foundry.toml and soldeer.lock disagree")
        self.assertEqual(foundry_version, remapping_version, "foundry.toml and remappings.txt disagree")
        self.assertEqual(
            foundry_version,
            checksum_version,
            "foundry.toml and dependency-checksums.txt disagree",
        )
        self.assertLessEqual(import_versions, {foundry_version})

    def test_soldeer_dependencies_use_registry_sources(self) -> None:
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

    def test_soldeer_source_policy_self_check(self) -> None:
        version = "5.6.1"
        self.assertEqual(version, self.assert_registry_version_only_dependency(OZ_PACKAGE, {"version": version}))
        with self.assertRaises(AssertionError):
            self.assert_registry_version_only_dependency(
                OZ_PACKAGE,
                {"version": version, "url": "https://example.com/pkg.zip"},
            )

        self.assert_allowed_soldeer_registry_url(
            OZ_PACKAGE,
            "https://soldeer-revisions.s3.amazonaws.com/"
            "@openzeppelin-contracts/5_6_1_15-03-2026_09:19:50_contracts.zip",
            version,
        )
        self.assert_allowed_soldeer_registry_url(
            FORGE_STD_PACKAGE,
            "https://soldeer-revisions.s3.amazonaws.com/forge-std/1_12_0_28-11-2025_13:04:44_forge-std-1.12.zip",
            "1.12.0",
        )

        rejected = [
            "https://github.com/OpenZeppelin/openzeppelin-contracts/archive/refs/tags/v5.6.1.zip",
            "https://codeload.github.com/OpenZeppelin/openzeppelin-contracts/zip/refs/tags/v5.6.1",
            "git+https://github.com/OpenZeppelin/openzeppelin-contracts.git",
            "https://example.com/@openzeppelin-contracts/5_6_1_contracts.zip",
            "https://soldeer-revisions.s3.amazonaws.com/@openzeppelin-contracts/5_6_1_source.zip",
            "http://soldeer-revisions.s3.amazonaws.com/@openzeppelin-contracts/5_6_1_contracts.zip",
        ]
        for url in rejected:
            with self.subTest(url=url):
                with self.assertRaises(AssertionError):
                    self.assert_allowed_soldeer_registry_url(OZ_PACKAGE, url, version)

    def foundry_openzeppelin_version(self) -> str:
        dependency = self.foundry_dependencies()[OZ_PACKAGE]
        version = dependency["version"]
        self.assertIsInstance(version, str)
        return version

    def foundry_dependencies(self) -> dict[str, dict[str, object]]:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
        dependencies = config.get("dependencies", {})
        self.assertIsInstance(dependencies, dict)
        self.assertIn(OZ_PACKAGE, dependencies, "expected OpenZeppelin dependency in foundry.toml")

        parsed: dict[str, dict[str, object]] = {}
        for name, dependency in dependencies.items():
            self.assertIsInstance(name, str)
            self.assertIsInstance(dependency, dict, f"{name} dependency must be a table")
            parsed[name] = dependency

        return parsed

    def locked_openzeppelin_version(self) -> str:
        return self.locked_dependency_records()[OZ_PACKAGE]["version"]

    def locked_dependency_records(self) -> dict[str, dict[str, str]]:
        lock = tomllib.loads(read_text(repo_path("soldeer.lock")))
        raw_records = lock.get("dependencies", [])
        self.assertIsInstance(raw_records, list)

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

        self.assertIn(OZ_PACKAGE, records, "expected OpenZeppelin dependency in soldeer.lock")
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
        return SOLDEER_ARCHIVE_SUFFIX_RE.get(name, DEFAULT_SOLDEER_ARCHIVE_SUFFIX_RE)

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
