from __future__ import annotations

import hashlib
import tempfile
import unittest
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .test_dependency_integrity import (
    DependencyRecord,
    DependencyVerificationError,
    DependencyVerifier,
)


FIXTURE_PACKAGE = "forge-std"
FIXTURE_VERSION = "1.0.0"
FIXTURE_KEY = f"{FIXTURE_PACKAGE}-{FIXTURE_VERSION}"
FIXTURE_ARCHIVE_URL = f"https://soldeer-revisions.s3.amazonaws.com/{FIXTURE_PACKAGE}/1_0_0_test_forge-std-1.0.zip"
FIXTURE_PLACEHOLDER_CHECKSUM = "1" * 64
FIXTURE_CONTRACT_SOURCE = "contract"


class DependencyIntegrityFixtureTest(unittest.TestCase):
    def test_rejects_unsafe_zip_paths(self) -> None:
        with self.fixture() as root:
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as zip_file:
                zip_file.writestr("../evil.txt", "bad")

            with self.assertRaisesRegex(DependencyVerificationError, "unsafe path"):
                DependencyVerifier(root).extract_verified_zip(FIXTURE_KEY, archive, root / "extract")

    def test_rejects_symlinked_dependency_verifier_boundaries(self) -> None:
        with self.fixture() as root:
            real_file = root / "real.txt"
            real_file.write_text("", encoding="utf-8")
            file_link = root / "foundry.toml"
            file_link.symlink_to(real_file)

            real_dir = root / "real-dependencies"
            real_dir.mkdir()
            dir_link = root / "dependencies"
            dir_link.symlink_to(real_dir, target_is_directory=True)

            with self.assertRaisesRegex(DependencyVerificationError, "required file must not be a symlink"):
                DependencyVerifier.require_file(file_link)
            with self.assertRaisesRegex(DependencyVerificationError, "required directory must not be a symlink"):
                DependencyVerifier.require_dir(dir_link)

    def test_rejects_archive_or_installed_tree_mismatch(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root, content=FIXTURE_CONTRACT_SOURCE)
            record = self.record(url=FIXTURE_ARCHIVE_URL, checksum="0" * 64)

            with self.assertRaisesRegex(DependencyVerificationError, "archive checksum mismatch"):
                verifier = DependencyVerifier(root)
                verifier.download_archive = (
                    lambda url, output, *, total_timeout_seconds: output.write_bytes(b"not the archive")
                )  # type: ignore[method-assign]
                verifier.verify_upstream_archive(root, record)

        with self.fixture() as root:
            self.write_minimal_dependency(root, content="installed")
            archive = root / "pkg.zip"
            with zipfile.ZipFile(archive, "w") as zip_file:
                zip_file.writestr("Package.sol", "upstream")

            record = self.record(url=FIXTURE_ARCHIVE_URL, checksum=self.file_hash(archive))

            with self.assertRaisesRegex(DependencyVerificationError, "installed tree does not match"):
                verifier = DependencyVerifier(root)
                verifier.download_archive = (
                    lambda url, output, *, total_timeout_seconds: output.write_bytes(archive.read_bytes())
                )  # type: ignore[method-assign]
                verifier.verify_upstream_archive(root, record)

    @contextmanager
    def fixture(self) -> Iterator[Path]:
        with tempfile.TemporaryDirectory(prefix="dependency-integrity-test-") as root:
            yield Path(root)

    def write_minimal_dependency(self, root_name: str | Path, *, content: str) -> Path:
        root = Path(root_name)
        dependency = root / "dependencies" / FIXTURE_KEY
        dependency.mkdir(parents=True)
        (dependency / "Package.sol").write_text(content, encoding="utf-8")

        record = self.record(url=FIXTURE_ARCHIVE_URL, checksum=FIXTURE_PLACEHOLDER_CHECKSUM)
        self.write_lock(root, [record])
        self.write_foundry(root, [record])
        (root / "remappings.txt").write_text(f"{FIXTURE_KEY}/=dependencies/{FIXTURE_KEY}/\n", encoding="utf-8")

        tree_hash = DependencyVerifier(root).tree_hash(dependency)
        (root / "dependency-checksums.txt").write_text(
            "# Deterministic SHA-256 of installed dependency file manifests.\n"
            "# Format: <sha256>  <dependency-name-version>\n"
            f"{tree_hash}  {FIXTURE_KEY}\n",
            encoding="utf-8",
        )
        return root

    def write_foundry(self, root: Path, records: list[DependencyRecord]) -> None:
        lines = ["[dependencies]"]
        for record in records:
            lines.append(f'{record.name} = {{ version = "{record.version}" }}')
        (root / "foundry.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def write_lock(self, root: Path, records: list[DependencyRecord]) -> None:
        lines: list[str] = []
        for record in records:
            lines.extend(
                [
                    "[[dependencies]]",
                    f'name = "{record.name}"',
                    f'version = "{record.version}"',
                    f'url = "{record.url}"',
                    f'checksum = "{record.checksum}"',
                    "",
                ]
            )
        (root / "soldeer.lock").write_text("\n".join(lines), encoding="utf-8")

    def record(
        self,
        *,
            url: str,
            checksum: str,
    ) -> DependencyRecord:
        return DependencyRecord(name=FIXTURE_PACKAGE, version=FIXTURE_VERSION, url=url, checksum=checksum)

    def file_hash(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()
