from __future__ import annotations

import re
import tomllib
import unittest
from urllib.parse import urlparse

from .common import iter_files, read_text, repo_path


OZ_PACKAGE = "@openzeppelin-contracts"
OZ_SOLDEER_HOST = "soldeer-revisions.s3.amazonaws.com"
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
        import_versions = self.imported_openzeppelin_versions()

        self.assertEqual(foundry_version, lock_version, "foundry.toml and soldeer.lock disagree")
        self.assertEqual(foundry_version, remapping_version, "foundry.toml and remappings.txt disagree")
        self.assertEqual(
            foundry_version,
            checksum_version,
            "foundry.toml and dependency-checksums.txt disagree",
        )
        self.assertLessEqual(import_versions, {foundry_version})

    def test_openzeppelin_uses_soldeer_registry_source(self) -> None:
        foundry_dependency = self.foundry_openzeppelin_dependency()
        self.assertEqual(
            {"version"},
            set(foundry_dependency),
            "OpenZeppelin must be declared as a Soldeer registry version only, without custom url metadata",
        )

        version = foundry_dependency["version"]
        self.assertIsInstance(version, str)

        record = self.locked_openzeppelin_record()
        self.assertEqual(version, record["version"], "foundry.toml and soldeer.lock disagree")
        self.assert_allowed_openzeppelin_soldeer_url(record["url"], version)

    def test_openzeppelin_source_policy_self_check(self) -> None:
        version = "5.6.1"
        self.assert_allowed_openzeppelin_soldeer_url(
            "https://soldeer-revisions.s3.amazonaws.com/"
            "@openzeppelin-contracts/5_6_1_15-03-2026_09:19:50_contracts.zip",
            version,
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
                    self.assert_allowed_openzeppelin_soldeer_url(url, version)

    def foundry_openzeppelin_version(self) -> str:
        dependency = self.foundry_openzeppelin_dependency()
        version = dependency["version"]
        self.assertIsInstance(version, str)
        return version

    def foundry_openzeppelin_dependency(self) -> dict[str, object]:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
        dependencies = config.get("dependencies", {})
        self.assertEqual([OZ_PACKAGE], [name for name in dependencies if name == OZ_PACKAGE])
        dependency = dependencies[OZ_PACKAGE]
        self.assertIsInstance(dependency, dict)
        return dependency

    def locked_openzeppelin_version(self) -> str:
        return self.locked_openzeppelin_record()["version"]

    def locked_openzeppelin_record(self) -> dict[str, str]:
        text = read_text(repo_path("soldeer.lock"))
        names = LOCK_NAME_RE.findall(text)
        versions = LOCK_VERSION_RE.findall(text)

        self.assertEqual([OZ_PACKAGE], [name for name in names if name == OZ_PACKAGE])
        self.assertEqual(len(names), len(versions), "soldeer.lock dependency records are malformed")

        lock = tomllib.loads(text)
        records = [
            record
            for record in lock.get("dependencies", [])
            if isinstance(record, dict) and record.get("name") == OZ_PACKAGE
        ]
        self.assertEqual(1, len(records), "expected exactly one OpenZeppelin lock record")

        record = records[0]
        for key in ("version", "url"):
            self.assertIsInstance(record.get(key), str, f"OpenZeppelin lock record missing {key}")

        return {"version": record["version"], "url": record["url"]}

    def assert_allowed_openzeppelin_soldeer_url(self, url: str, version: str) -> None:
        parsed = urlparse(url)
        expected_version_prefix = version.replace(".", "_")

        self.assertEqual("https", parsed.scheme, f"OpenZeppelin lock URL must use https: {url}")
        self.assertEqual(OZ_SOLDEER_HOST, parsed.netloc, f"OpenZeppelin lock URL must use Soldeer revisions: {url}")
        self.assertRegex(
            parsed.path,
            rf"^/{re.escape(OZ_PACKAGE)}/{re.escape(expected_version_prefix)}_[^/]+_contracts\.zip$",
            f"OpenZeppelin lock URL must point to the Soldeer contracts package: {url}",
        )

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
