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
FOUNDRY_DEP_RE = re.compile(
    r'^(?P<name>"[^"]+"|[^\s=]+)\s*=\s*\{\s*version\s*=\s*"(?P<version>[^"]+)"\s*\}\s*(?:#.*)?$'
)
SOLDEER_REVISIONS_HOST = "soldeer-revisions.s3.amazonaws.com"
SOLDEER_ARCHIVE_SUFFIX_RE = {
    "@openzeppelin-contracts": r"contracts",
    "forge-std": r"forge-std-[0-9]+(?:\.[0-9]+)*",
}
DEPENDENCIES_DIR_NAME = "dependencies"
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


@dataclass(frozen=True)
class DependencyPatch:
    dependency: str
    target: str
    patch_file: str
    pre_hash: str
    patch_hash: str
    post_hash: str


class DependencyVerifier:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.foundry_file = root / "foundry.toml"
        self.lock_file = root / "soldeer.lock"
        self.remappings_file = root / "remappings.txt"
        self.checksums_file = root / "dependency-checksums.txt"
        self.patches_file = root / "dependency-patches.txt"
        self.dependencies_dir = root / DEPENDENCIES_DIR_NAME

    def verify_local(self) -> None:
        records = self.load_dependency_records()
        self.verify_dependency_source_policy(records)
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

        self.verify_declared_patches({record.key for record in records})

    def verify_upstream(self, records: list[DependencyRecord] | None = None) -> None:
        if records is None:
            records = self.load_dependency_records()

        self.verify_dependency_source_policy(records)
        self.verify_dependency_set(records)

        with tempfile.TemporaryDirectory(prefix="deps-verify-") as tmp:
            tmp_path = Path(tmp)
            for record in records:
                self.verify_upstream_archive(tmp_path, record)

    def write_local_checksums(self) -> None:
        records = self.load_dependency_records()
        self.verify_dependency_source_policy(records)
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

    def load_foundry_dependencies(self) -> dict[str, str]:
        self.require_file(self.foundry_file)

        dependencies: dict[str, str] = {}
        in_dependencies = False

        for line_number, raw_line in enumerate(self.foundry_file.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            if line.startswith("[") and line.endswith("]"):
                in_dependencies = line == "[dependencies]"
                continue

            if not in_dependencies:
                continue

            match = FOUNDRY_DEP_RE.match(line)
            if match is None:
                raise DependencyVerificationError(
                    f"{self.foundry_file}:{line_number}: dependencies must use registry version-only form"
                )

            name = self.unquote_toml_key(match.group("name"))
            if name in dependencies:
                raise DependencyVerificationError(f"duplicate dependency in {self.foundry_file}: {name}")
            dependencies[name] = match.group("version")

        if not dependencies:
            raise DependencyVerificationError(f"no dependencies found in {self.foundry_file}")

        return dependencies

    def verify_dependency_source_policy(self, records: list[DependencyRecord]) -> None:
        foundry_dependencies = self.load_foundry_dependencies()
        locked_dependencies: dict[str, DependencyRecord] = {}

        for record in records:
            if record.name in locked_dependencies:
                raise DependencyVerificationError(f"duplicate dependency in {self.lock_file}: {record.name}")
            locked_dependencies[record.name] = record

        foundry_names = set(foundry_dependencies)
        locked_names = set(locked_dependencies)
        missing = sorted(foundry_names - locked_names)
        unexpected = sorted(locked_names - foundry_names)

        if missing:
            raise DependencyVerificationError(f"dependencies missing from {self.lock_file}: {', '.join(missing)}")
        if unexpected:
            raise DependencyVerificationError(f"unexpected dependencies in {self.lock_file}: {', '.join(unexpected)}")

        for name, version in sorted(foundry_dependencies.items()):
            record = locked_dependencies[name]
            if record.version != version:
                raise DependencyVerificationError(
                    f"{name} version differs between {self.foundry_file} and {self.lock_file}: "
                    f"{version} != {record.version}"
                )
            self.validate_soldeer_registry_url(record)

    def validate_soldeer_registry_url(self, record: DependencyRecord) -> None:
        parsed = urlparse(record.url)
        expected_version_prefix = record.version.replace(".", "_")

        if parsed.scheme != "https":
            raise DependencyVerificationError(f"{record.key} lock URL must use https: {record.url}")
        if parsed.hostname is None:
            raise DependencyVerificationError(f"{record.key} lock URL must include a host: {record.url}")
        host = parsed.hostname.lower().rstrip(".")
        if parsed.username or parsed.password or parsed.port is not None:
            raise DependencyVerificationError(f"{record.key} lock URL must not include userinfo or port: {record.url}")
        if host != SOLDEER_REVISIONS_HOST:
            raise DependencyVerificationError(f"{record.key} lock URL must use Soldeer revisions: {record.url}")
        if parsed.params or parsed.query or parsed.fragment:
            raise DependencyVerificationError(f"{record.key} lock URL must not include params, query, or fragment: {record.url}")
        suffix_re = SOLDEER_ARCHIVE_SUFFIX_RE.get(record.name)
        if suffix_re is None:
            raise DependencyVerificationError(f"{record.name} must have an explicit Soldeer archive suffix policy")

        if re.fullmatch(rf"/{re.escape(record.name)}/{re.escape(expected_version_prefix)}_[^/]+_{suffix_re}\.zip", parsed.path) is None:
            raise DependencyVerificationError(
                f"{record.key} lock URL must point to an allowed Soldeer archive: {record.url}"
            )

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

    def load_dependency_patches(self) -> list[DependencyPatch]:
        if not self.patches_file.exists():
            return []

        records: list[DependencyPatch] = []

        for line_number, raw_line in enumerate(self.patches_file.read_text(encoding="utf-8").splitlines(), start=1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue

            parts = line.split()
            if len(parts) != 6:
                raise DependencyVerificationError(f"{self.patches_file}:{line_number}: malformed dependency patch line")

            records.append(DependencyPatch(*parts))

        return records

    def verify_declared_patches(self, expected_dependencies: set[str]) -> None:
        for record in self.load_dependency_patches():
            self.verify_declared_patch(record, expected_dependencies)

    def verify_declared_patch(self, record: DependencyPatch, expected_dependencies: set[str]) -> None:
        if record.dependency not in expected_dependencies:
            raise DependencyVerificationError(f"patch references unknown dependency: {record.dependency}")

        self.require_safe_dependency_patch_path(record.dependency, "dependency key")
        self.require_safe_dependency_patch_path(record.target, "patch target")
        self.require_safe_dependency_patch_path(record.patch_file, "patch file")

        if "/" in record.dependency:
            raise DependencyVerificationError(f"patch dependency must be a single directory name: {record.dependency}")

        target_path = self.dependencies_dir / record.dependency / record.target
        patch_path = self.root / record.patch_file
        self.require_file(target_path)
        self.require_file(patch_path)

        actual_patch_hash = self.file_hash(patch_path)
        if actual_patch_hash != record.patch_hash:
            raise DependencyVerificationError(
                f"{record.patch_file} checksum mismatch: expected {record.patch_hash}, got {actual_patch_hash}"
            )

        actual_target_hash = self.file_hash(target_path)
        if actual_target_hash != record.post_hash:
            raise DependencyVerificationError(
                f"{record.dependency}/{record.target} patched checksum mismatch: "
                f"expected {record.post_hash}, got {actual_target_hash}"
            )

        print(f"deps-verify: {record.dependency} declared patch ok")
        print(f"deps-verify:   target: {record.target}")
        print(f"deps-verify:   patch: {record.patch_file}")
        print(f"deps-verify:   pristine: {record.pre_hash}")
        print(f"deps-verify:   patched:  {record.post_hash}")
        print("deps-verify:   Forge may also warn FailedIntegrity for this declared patch.")

    def verify_upstream_archive(self, tmp_path: Path, record: DependencyRecord) -> None:
        self.validate_archive_checksum(record)
        self.require_dir(self.dependencies_dir / record.key)

        parsed = urlparse(record.url)
        if parsed.scheme != "https":
            raise DependencyVerificationError(f"{record.key} upstream URL must use https: {record.url}")

        archive = tmp_path / f"{record.key}.zip"
        extract_dir = tmp_path / "extract" / record.key

        self.download_archive(record.url, archive, total_timeout_seconds=DOWNLOAD_TOTAL_TIMEOUT_SECONDS)
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
        total_timeout_seconds: float,
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
        expected = f"{key}/={DEPENDENCIES_DIR_NAME}/{key}/"
        lines = self.remappings_file.read_text(encoding="utf-8").splitlines()
        if expected not in lines:
            raise DependencyVerificationError(f"missing remapping for {key} in {self.remappings_file}")

    def require_safe_dependency_patch_path(self, value: str, label: str) -> None:
        path = Path(value)
        if value == "" or path.is_absolute() or ".." in path.parts:
            raise DependencyVerificationError(f"unsafe dependency patch {label}: {value}")

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
    def unquote_toml_key(value: str) -> str:
        if value.startswith('"') and value.endswith('"'):
            return value[1:-1]
        return value

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
    parser.add_argument("root")
    parser.add_argument("--verify-upstream", action="store_true", help="verify upstream archives without writing checksums")
    parser.add_argument("--write-checksums", action="store_true", help="write checksums for the local dependency tree")
    args = parser.parse_args()

    verifier = DependencyVerifier(Path(args.root))
    try:
        modes = [args.verify_upstream, args.write_checksums]
        if sum(1 for enabled in modes if enabled) > 1:
            raise DependencyVerificationError("choose only one dependency verifier mode")

        if args.verify_upstream:
            verifier.verify_upstream()
        elif args.write_checksums:
            verifier.write_local_checksums()
        else:
            verifier.verify_local()
    except DependencyVerificationError as exc:
        print(f"deps-verify: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
