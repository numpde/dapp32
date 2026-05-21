from __future__ import annotations

import hashlib
import re
import unittest
from dataclasses import dataclass
from pathlib import Path

from .common import read_text, repo_path


CHECKSUM_RE = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class DependencyPatch:
    dependency: str
    target: str
    patch_file: str
    pre_hash: str
    patch_hash: str
    post_hash: str


class DependencyPatchTest(unittest.TestCase):
    def test_dependency_patch_manifest_is_well_formed(self) -> None:
        records = self.read_manifest()
        self.assertTrue(records, "dependency patch manifest should declare at least one patch")

        for record in records:
            with self.subTest(patch=record.patch_file):
                self.assert_safe_single_directory(record.dependency)
                self.assert_safe_relative_path(record.target)
                self.assert_safe_relative_path(record.patch_file)
                self.assert_checksums(record.pre_hash, record.patch_hash, record.post_hash)
                self.assert_patch_hash_matches(record)
                self.assert_patch_targets_declared_file(record)

    def read_manifest(self) -> list[DependencyPatch]:
        path = repo_path("dependency-patches.txt")
        records: list[DependencyPatch] = []

        for line_number, raw_line in enumerate(read_text(path).splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split()
            self.assertEqual(6, len(parts), f"{path}:{line_number}: malformed dependency patch line")
            records.append(DependencyPatch(*parts))

        return records

    def assert_safe_single_directory(self, value: str) -> None:
        self.assert_safe_relative_path(value)
        self.assertNotIn("/", value, "dependency key must be a single directory name")

    def assert_safe_relative_path(self, value: str) -> None:
        self.assertTrue(value, "relative path must not be empty")
        path = Path(value)
        self.assertFalse(path.is_absolute(), f"path must be relative: {value}")
        self.assertNotIn("..", path.parts, f"path must not escape repo/workspace: {value}")

    def assert_checksums(self, *values: str) -> None:
        for value in values:
            self.assertRegex(value, CHECKSUM_RE)

    def assert_patch_hash_matches(self, record: DependencyPatch) -> None:
        patch_path = repo_path(record.patch_file)
        self.assertTrue(patch_path.is_file(), f"missing dependency patch: {record.patch_file}")
        actual = hashlib.sha256(patch_path.read_bytes()).hexdigest()
        self.assertEqual(record.patch_hash, actual)

    def assert_patch_targets_declared_file(self, record: DependencyPatch) -> None:
        patch_text = read_text(repo_path(record.patch_file))
        self.assertIn(f"--- a/{record.target}", patch_text)
        self.assertIn(f"+++ b/{record.target}", patch_text)
