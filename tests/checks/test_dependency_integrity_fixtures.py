from __future__ import annotations

import hashlib
import io
import tempfile
import unittest
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from .test_dependency_integrity import (
    DependencyRecord,
    DependencyVerificationError,
    DependencyVerifier,
    NoRedirectHandler,
)


class DependencyIntegrityFixtureTest(unittest.TestCase):
    def test_rejects_bad_checksum_lines(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            (root / "dependency-checksums.txt").write_text("not-a-checksum  pkg-1.0.0\n", encoding="utf-8")

            with self.assertRaisesRegex(DependencyVerificationError, "malformed dependency checksum line"):
                DependencyVerifier(root).read_checksum_file()

    def test_rejects_duplicate_lock_entries(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            self.write_lock(root, [self.record(), self.record()])

            with self.assertRaisesRegex(DependencyVerificationError, "duplicate dependencies"):
                verifier = DependencyVerifier(root)
                verifier.verify_dependency_set(verifier.load_dependency_records())

    def test_rejects_missing_remapping(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            (root / "remappings.txt").write_text("", encoding="utf-8")

            with self.assertRaisesRegex(DependencyVerificationError, "missing remapping"):
                DependencyVerifier(root).verify_local()

    def test_rejects_declared_patch_file_checksum_mismatch(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            self.write_patch_manifest(root, patch_hash="0" * 64)

            with self.assertRaisesRegex(DependencyVerificationError, "patches/pkg.patch checksum mismatch"):
                with redirect_stdout(io.StringIO()):
                    DependencyVerifier(root).verify_local()

    def test_rejects_declared_patch_target_checksum_mismatch(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            self.write_patch_manifest(root, post_hash="0" * 64)

            with self.assertRaisesRegex(DependencyVerificationError, "patched checksum mismatch"):
                with redirect_stdout(io.StringIO()):
                    DependencyVerifier(root).verify_local()

    def test_reports_declared_patches(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            self.write_patch_manifest(root)

            output = io.StringIO()
            with redirect_stdout(output):
                DependencyVerifier(root).verify_local()

            self.assertIn("deps-verify: pkg-1.0.0 declared patch ok", output.getvalue())
            self.assertIn("deps-verify:   target: Package.sol", output.getvalue())
            self.assertIn("Forge may also warn FailedIntegrity", output.getvalue())

    def test_rejects_foundry_dependency_custom_url(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            (root / "foundry.toml").write_text(
                '[dependencies]\npkg = { version = "1.0.0", url = "https://example.invalid/pkg.zip" }\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(DependencyVerificationError, "registry version-only form"):
                verifier = DependencyVerifier(root)
                verifier.verify_dependency_source_policy(verifier.load_dependency_records())

    def test_rejects_lock_url_outside_soldeer_registry(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            self.write_lock(root, [self.record(url="https://example.invalid/pkg/1_0_0_test_contracts.zip")])

            with self.assertRaisesRegex(DependencyVerificationError, "must use Soldeer revisions"):
                verifier = DependencyVerifier(root)
                verifier.verify_dependency_source_policy(verifier.load_dependency_records())

    def test_rejects_unsafe_zip_paths(self) -> None:
        with self.fixture() as root:
            archive = root / "unsafe.zip"
            with zipfile.ZipFile(archive, "w") as zip_file:
                zip_file.writestr("../evil.txt", "bad")

            with self.assertRaisesRegex(DependencyVerificationError, "unsafe path"):
                DependencyVerifier(root).extract_verified_zip("pkg-1.0.0", archive, root / "extract")

    def test_rejects_non_https_url(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            record = self.record(url="http://example.invalid/pkg.zip")

            with self.assertRaisesRegex(DependencyVerificationError, "must use https"):
                DependencyVerifier(root).verify_upstream_archive(root, record)

    def test_rejects_archive_checksum_mismatch(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root)
            record = self.record(checksum="0" * 64)

            with self.assertRaisesRegex(DependencyVerificationError, "archive checksum mismatch"):
                verifier = DependencyVerifier(root)
                verifier.download_archive = lambda url, output: output.write_bytes(b"not the archive")  # type: ignore[method-assign]
                verifier.verify_upstream_archive(root, record)

    def test_rejects_installed_tree_mismatch(self) -> None:
        with self.fixture() as root:
            self.write_minimal_dependency(root, content="installed")
            archive = root / "pkg.zip"
            with zipfile.ZipFile(archive, "w") as zip_file:
                zip_file.writestr("Package.sol", "upstream")

            record = self.record(checksum=self.file_hash(archive))

            with self.assertRaisesRegex(DependencyVerificationError, "installed tree does not match"):
                verifier = DependencyVerifier(root)
                verifier.download_archive = lambda url, output: output.write_bytes(archive.read_bytes())  # type: ignore[method-assign]
                verifier.verify_upstream_archive(root, record)

    def test_rejects_http_redirects(self) -> None:
        with self.assertRaisesRegex(DependencyVerificationError, "unexpected HTTP redirect"):
            NoRedirectHandler().redirect_request(None, None, 302, "Found", {}, "https://example.invalid/next.zip")

    def test_download_enforces_total_timeout(self) -> None:
        with self.fixture() as root:
            response = SlowResponse()
            opener = mock.Mock()
            opener.open.return_value = response

            with mock.patch("urllib.request.build_opener", return_value=opener):
                with self.assertRaisesRegex(DependencyVerificationError, "total timeout"):
                    DependencyVerifier(root).download_archive(
                        "https://example.invalid/pkg.zip",
                        root / "pkg.zip",
                        total_timeout_seconds=-1,
                    )

    @contextmanager
    def fixture(self) -> Iterator[Path]:
        with tempfile.TemporaryDirectory(prefix="dependency-integrity-test-") as root:
            yield Path(root)

    def write_minimal_dependency(self, root_name: str | Path, *, content: str = "contract") -> Path:
        root = Path(root_name)
        dependency = root / "dependencies" / "pkg-1.0.0"
        dependency.mkdir(parents=True)
        (dependency / "Package.sol").write_text(content, encoding="utf-8")

        record = self.record()
        self.write_lock(root, [record])
        self.write_foundry(root, [record])
        (root / "remappings.txt").write_text("pkg-1.0.0/=dependencies/pkg-1.0.0/\n", encoding="utf-8")

        tree_hash = DependencyVerifier(root).tree_hash(dependency)
        (root / "dependency-checksums.txt").write_text(
            "# Deterministic SHA-256 of installed dependency file manifests.\n"
            "# Format: <sha256>  <dependency-name-version>\n"
            f"{tree_hash}  pkg-1.0.0\n",
            encoding="utf-8",
        )
        return root

    def write_foundry(self, root: Path, records: list[DependencyRecord]) -> None:
        lines = ["[dependencies]"]
        for record in records:
            lines.append(f'{record.name} = {{ version = "{record.version}" }}')
        (root / "foundry.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")

    def write_patch_manifest(
        self,
        root: Path,
        *,
        patch_hash: str | None = None,
        post_hash: str | None = None,
    ) -> None:
        patch = root / "patches" / "pkg.patch"
        patch.parent.mkdir(parents=True)
        patch.write_text("--- a/Package.sol\n+++ b/Package.sol\n", encoding="utf-8")

        target = root / "dependencies" / "pkg-1.0.0" / "Package.sol"
        (root / "dependency-patches.txt").write_text(
            "pkg-1.0.0  Package.sol  patches/pkg.patch  "
            f"{self.file_hash(target)}  "
            f"{patch_hash or self.file_hash(patch)}  "
            f"{post_hash or self.file_hash(target)}\n",
            encoding="utf-8",
        )

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
        url: str = "https://soldeer-revisions.s3.amazonaws.com/pkg/1_0_0_test_contracts.zip",
        checksum: str = "1" * 64,
    ) -> DependencyRecord:
        return DependencyRecord(name="pkg", version="1.0.0", url=url, checksum=checksum)

    def file_hash(self, path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()


class SlowResponse:
    def __enter__(self) -> "SlowResponse":
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def geturl(self) -> str:
        return "https://example.invalid/pkg.zip"

    def read(self, size: int) -> bytes:
        return b"x"
