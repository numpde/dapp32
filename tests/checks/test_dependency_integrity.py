from __future__ import annotations

import argparse
import hashlib
import re
import socket
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


TEST_PATH = Path(__file__).resolve()
ROOT = TEST_PATH.parents[2] if len(TEST_PATH.parents) > 2 else Path.cwd()
VALUE_RE = re.compile(r'^(?P<key>[a-z_]+)\s*=\s*"(?P<value>[^"]*)"$')
CHECKSUM_RE = re.compile(r"^(?P<hash>[0-9a-f]{64})  (?P<key>\S+)$")
DOWNLOAD_TIMEOUT_SECONDS = 15
DOWNLOAD_TOTAL_TIMEOUT_SECONDS = 300
DOWNLOAD_CHUNK_BYTES = 1024 * 1024


class DependencyVerificationError(Exception):
    pass


@dataclass(frozen=True)
class DependencyRecord:
    name: str
    version: str
    url: str
    checksum: str

    @property
    def key(self) -> str:
        return f"{self.name}-{self.version}"


class DependencyVerifier:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.lock_file = root / "soldeer.lock"
        self.remappings_file = root / "remappings.txt"
        self.checksums_file = root / "dependency-checksums.txt"
        self.dependencies_dir = root / "dependencies"

    def verify_local(self) -> None:
        records = self.load_dependency_records()
        self.verify_dependency_set(records)
        expected_hashes = self.load_expected_hashes(records)

        for record in records:
            actual = self.tree_hash(self.dependencies_dir / record.key)
            expected = expected_hashes[record.key]
            if actual != expected:
                raise DependencyVerificationError(
                    f"{record.key} checksum mismatch: expected {expected}, got {actual}"
                )
            self.require_remapping(record.key)
            print(f"deps-verify: {record.key} ok")

    def verify_stage(self) -> None:
        records = self.load_dependency_records()
        self.verify_upstream(records)
        self.write_checksums(records)

    def verify_upstream(self, records: list[DependencyRecord] | None = None) -> None:
        if records is None:
            records = self.load_dependency_records()

        self.verify_dependency_set(records)

        with tempfile.TemporaryDirectory(prefix="deps-verify-") as tmp:
            tmp_path = Path(tmp)
            for record in records:
                self.verify_upstream_archive(tmp_path, record)

    def write_local_checksums(self) -> None:
        records = self.load_dependency_records()
        self.verify_dependency_set(records)
        self.write_checksums(records)

    def load_dependency_records(self) -> list[DependencyRecord]:
        self.require_file(self.lock_file)

        records: list[DependencyRecord] = []
        current: dict[str, str] = {}

        def emit() -> None:
            nonlocal current
            if not current:
                return

            required = {"name", "version", "url", "checksum"}
            missing = sorted(required - current.keys())
            if missing:
                raise DependencyVerificationError(
                    f"malformed dependency record in {self.lock_file}: missing {', '.join(missing)}"
                )

            records.append(
                DependencyRecord(
                    name=current["name"],
                    version=current["version"],
                    url=current["url"],
                    checksum=current["checksum"],
                )
            )
            current = {}

        for raw_line in self.lock_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if line == "[[dependencies]]":
                emit()
                continue

            match = VALUE_RE.match(line)
            if match and match.group("key") in {"name", "version", "url", "checksum"}:
                current[match.group("key")] = match.group("value")

        emit()

        if not records:
            raise DependencyVerificationError(f"no dependencies found in {self.lock_file}")

        return records

    def verify_dependency_set(self, records: list[DependencyRecord]) -> None:
        self.require_file(self.remappings_file)
        self.require_dir(self.dependencies_dir)

        expected = sorted(record.key for record in records)
        self.reject_duplicates(expected, f"duplicate dependencies in {self.lock_file}")

        actual_dirs: list[str] = []
        unexpected_files: list[str] = []
        for entry in self.dependencies_dir.iterdir():
            if entry.is_dir() and not entry.is_symlink():
                actual_dirs.append(entry.name)
            else:
                unexpected_files.append(str(entry))

        actual = sorted(actual_dirs)
        missing = sorted(set(expected) - set(actual))
        unexpected = sorted(set(actual) - set(expected))

        if missing:
            raise DependencyVerificationError(f"missing dependency directories: {', '.join(missing)}")
        if unexpected:
            raise DependencyVerificationError(f"unexpected dependency directories: {', '.join(unexpected)}")
        if unexpected_files:
            raise DependencyVerificationError(
                f"unexpected dependency files: {', '.join(sorted(unexpected_files))}"
            )

    def load_expected_hashes(self, records: list[DependencyRecord]) -> dict[str, str]:
        self.require_file(self.checksums_file)

        expected_keys = sorted(record.key for record in records)
        expected = self.read_checksum_file()
        actual_keys = sorted(expected)

        missing = sorted(set(expected_keys) - set(actual_keys))
        unexpected = sorted(set(actual_keys) - set(expected_keys))

        if missing:
            raise DependencyVerificationError(f"missing checksums in {self.checksums_file}: {', '.join(missing)}")
        if unexpected:
            raise DependencyVerificationError(
                f"unexpected checksums in {self.checksums_file}: {', '.join(unexpected)}"
            )

        return expected

    def read_checksum_file(self) -> dict[str, str]:
        hashes: dict[str, str] = {}

        for line_number, raw_line in enumerate(self.checksums_file.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            match = CHECKSUM_RE.match(line)
            if match is None:
                raise DependencyVerificationError(
                    f"{self.checksums_file}:{line_number}: malformed dependency checksum line"
                )

            key = match.group("key")
            if key in hashes:
                raise DependencyVerificationError(f"duplicate checksums in {self.checksums_file}: {key}")
            hashes[key] = match.group("hash")

        return hashes

    def verify_upstream_archive(self, tmp_path: Path, record: DependencyRecord) -> None:
        self.validate_archive_checksum(record)
        self.require_dir(self.dependencies_dir / record.key)

        parsed = urlparse(record.url)
        if parsed.scheme != "https":
            raise DependencyVerificationError(f"{record.key} upstream URL must use https: {record.url}")

        archive = tmp_path / f"{record.key}.zip"
        extract_dir = tmp_path / "extract" / record.key

        self.download_archive(record.url, archive)
        actual_archive_checksum = self.file_hash(archive)
        if actual_archive_checksum != record.checksum:
            raise DependencyVerificationError(
                f"{record.key} upstream archive checksum mismatch: "
                f"expected {record.checksum}, got {actual_archive_checksum}"
            )

        extract_dir.mkdir(parents=True, exist_ok=True)
        self.extract_verified_zip(record.key, archive, extract_dir)
        payload_dir = self.archive_payload_dir(extract_dir)

        expected_tree_hash = self.tree_hash(payload_dir)
        actual_tree_hash = self.tree_hash(self.dependencies_dir / record.key)
        if actual_tree_hash != expected_tree_hash:
            raise DependencyVerificationError(f"{record.key} installed tree does not match verified upstream archive")

        print(f"deps-verify: {record.key} upstream archive ok")

    def download_archive(
        self,
        url: str,
        output: Path,
        *,
        total_timeout_seconds: float = DOWNLOAD_TOTAL_TIMEOUT_SECONDS,
    ) -> None:
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                deadline = time.monotonic() + total_timeout_seconds
                opener = urllib.request.build_opener(NoRedirectHandler)
                with opener.open(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
                    final_url = response.geturl()
                    if urlparse(final_url).scheme != "https":
                        raise DependencyVerificationError(f"download resolved to non-HTTPS URL: {final_url}")

                    with output.open("wb") as destination:
                        while True:
                            if time.monotonic() > deadline:
                                raise DependencyVerificationError(
                                    f"download exceeded {total_timeout_seconds:g}s total timeout: {url}"
                                )

                            chunk = response.read(DOWNLOAD_CHUNK_BYTES)
                            if not chunk:
                                break
                            destination.write(chunk)
                return
            except (TimeoutError, socket.timeout, urllib.error.URLError) as exc:
                last_error = exc
                if attempt < 3:
                    time.sleep(2)
            except DependencyVerificationError:
                raise

        raise DependencyVerificationError(f"could not download {url}: {last_error}")

    def extract_verified_zip(self, key: str, archive: Path, extract_dir: Path) -> None:
        with zipfile.ZipFile(archive) as zip_file:
            for member in zip_file.infolist():
                path = Path(member.filename)
                if (
                    member.filename == ""
                    or path.is_absolute()
                    or ".." in path.parts
                    or member.filename.startswith(("/", "\\"))
                ):
                    raise DependencyVerificationError(f"{key} archive contains an unsafe path")

            zip_file.extractall(extract_dir)

    def archive_payload_dir(self, extract_dir: Path) -> Path:
        entries = list(extract_dir.iterdir())
        if len(entries) == 1 and entries[0].is_dir() and not entries[0].is_symlink():
            return entries[0]
        return extract_dir

    def write_checksums(self, records: list[DependencyRecord]) -> None:
        lines = [
            "# Deterministic SHA-256 of installed dependency file manifests.",
            "# Format: <sha256>  <dependency-name-version>",
        ]

        for record in records:
            self.require_remapping(record.key)
            lines.append(f"{self.tree_hash(self.dependencies_dir / record.key)}  {record.key}")

        self.checksums_file.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def tree_hash(self, root: Path) -> str:
        self.require_dir(root)

        files: list[Path] = []
        unsupported: list[str] = []
        for path in root.rglob("*"):
            if path.is_symlink():
                unsupported.append(str(path))
            elif path.is_dir():
                continue
            elif path.is_file():
                files.append(path)
            else:
                unsupported.append(str(path))

        if unsupported:
            raise DependencyVerificationError(
                f"unsupported dependency entries under {root}: {', '.join(sorted(unsupported))}"
            )

        manifest = hashlib.sha256()
        for path in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
            rel = path.relative_to(root).as_posix()
            manifest.update(f"{self.file_hash(path)}  {rel}\n".encode())

        return manifest.hexdigest()

    def require_remapping(self, key: str) -> None:
        expected = f"{key}/=dependencies/{key}/"
        lines = self.remappings_file.read_text(encoding="utf-8").splitlines()
        if expected not in lines:
            raise DependencyVerificationError(f"missing remapping for {key} in {self.remappings_file}")

    def validate_archive_checksum(self, record: DependencyRecord) -> None:
        if CHECKSUM_RE.match(f"{record.checksum}  {record.key}") is None:
            raise DependencyVerificationError(f"{record.key} has invalid upstream checksum in {self.lock_file}")

    @staticmethod
    def file_hash(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    @staticmethod
    def reject_duplicates(values: list[str], message: str) -> None:
        duplicates = sorted({value for value in values if values.count(value) > 1})
        if duplicates:
            raise DependencyVerificationError(f"{message}: {', '.join(duplicates)}")

    @staticmethod
    def require_file(path: Path) -> None:
        if not path.is_file():
            raise DependencyVerificationError(f"missing required file: {path}")

    @staticmethod
    def require_dir(path: Path) -> None:
        if not path.is_dir():
            raise DependencyVerificationError(f"missing required directory: {path}")


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DependencyVerificationError(f"unexpected HTTP redirect while downloading dependency archive: {newurl}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify installed Soldeer dependency integrity.")
    parser.add_argument("root", nargs="?", default="/work")
    parser.add_argument("--stage", action="store_true", help="verify upstream archives and write checksums")
    parser.add_argument("--verify-upstream", action="store_true", help="verify upstream archives without writing checksums")
    parser.add_argument("--write-checksums", action="store_true", help="write checksums for the local dependency tree")
    args = parser.parse_args()

    verifier = DependencyVerifier(Path(args.root))
    try:
        modes = [args.stage, args.verify_upstream, args.write_checksums]
        if sum(1 for enabled in modes if enabled) > 1:
            raise DependencyVerificationError("choose only one dependency verifier mode")

        if args.stage:
            verifier.verify_stage()
        elif args.verify_upstream:
            verifier.verify_upstream()
        elif args.write_checksums:
            verifier.write_local_checksums()
        else:
            verifier.verify_local()
    except DependencyVerificationError as exc:
        print(f"deps-verify: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
