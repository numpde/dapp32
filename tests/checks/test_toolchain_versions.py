from __future__ import annotations

import re
import tomllib
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from .common import iter_files, path_has_symlink, read_text, repo_path


FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry"
SOLC_ARG_RE = re.compile(r"^ARG\s+SOLC_VERSION=(?P<version>[0-9]+\.[0-9]+\.[0-9]+)$", re.MULTILINE)
PINNED_IMAGE_REF_RE = re.compile(r"^[^\s:@]+(?:/[^\s:@]+)*(?::[^@\s]+)@sha256:[0-9a-f]{64}$")
DOCKERFILE_FROM_RE = re.compile(r"^FROM\s+(?P<image>[^\s]+)(?:\s+AS\s+[A-Za-z0-9_.-]+)?$", re.MULTILINE | re.IGNORECASE)
COMPOSE_IMAGE_RE = re.compile(r"^\s+image:\s+(?P<image>\S+)\s*$", re.MULTILINE)
COMPOSE_BUILD_CONTEXT_RE = re.compile(r"^\s+context:\s+(?P<context>\S+)\s*$", re.MULTILINE)
COMPOSE_BUILDFILE_RE = re.compile(r"^\s+dockerfile:\s+(?P<dockerfile>\S+)\s*$", re.MULTILINE)


@dataclass(frozen=True)
class PinnedImageRef:
    path: Path
    image: str
    tag: str
    digest: str

    @property
    def reference(self) -> str:
        return f"{self.image}:{self.tag}@sha256:{self.digest}"


class ToolchainVersionTest(unittest.TestCase):
    def test_all_container_image_references_are_digest_pinned(self) -> None:
        # Local lanes are only reproducible if every base/runtime image is an
        # explicit artifact. Tags alone are mutable, even when they look exact.
        failures: list[str] = []
        for path in self.image_reference_files():
            text = read_text(path)
            for line_number, image in self.dockerfile_from_images(text):
                if not self.is_pinned_image_reference(image):
                    failures.append(f"{path}:{line_number}: Dockerfile FROM image must be tag-and-digest pinned: {image}")
            for line_number, image in self.compose_images(text):
                if not self.is_pinned_image_reference(image):
                    failures.append(f"{path}:{line_number}: Compose image must be tag-and-digest pinned: {image}")

        if failures:
            self.fail("\n".join(failures))

    def test_compose_builds_use_explicit_container_contexts(self) -> None:
        failures: list[str] = []
        for path in self.compose_files():
            text = read_text(path)
            # Compose build contexts define what Docker can see at image build
            # time. Keep them in containers/ so service builds cannot quietly
            # start sending repo or dapp source trees into Docker build context.
            for line_number, context in self.compose_build_contexts(text):
                candidate = path.parent / context
                resolved = candidate.resolve()
                containers_root = repo_path("containers").resolve()
                if path_has_symlink(candidate):
                    failures.append(f"{path}:{line_number}: Compose build context must not pass through a symlink: {context}")
                elif not candidate.is_dir():
                    failures.append(f"{path}:{line_number}: Compose build context must be an existing directory: {context}")
                elif resolved == containers_root or containers_root not in resolved.parents:
                    failures.append(f"{path}:{line_number}: Compose build context must stay under containers/: {context}")
            for line_number, dockerfile in self.compose_build_dockerfiles(text):
                if dockerfile != "Dockerfile":
                    failures.append(f"{path}:{line_number}: Compose build dockerfile must be Dockerfile: {dockerfile}")

        if failures:
            self.fail("\n".join(failures))

    def test_build_context_symlink_guard_checks_unresolved_components(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            real = root / "containers" / "real"
            real.mkdir(parents=True)
            link = root / "containers" / "link"
            link.symlink_to(real, target_is_directory=True)

            # Path.resolve() hides this case by returning the target. The
            # posture check must inspect the operator-written context path
            # before resolving containment.
            self.assertTrue(path_has_symlink(link / "nested"))
            self.assertFalse(path_has_symlink(real))

    def test_container_build_contexts_are_deny_by_default(self) -> None:
        failures: list[str] = []

        for dockerfile in sorted(repo_path("containers").glob("*/Dockerfile")):
            dockerignore = dockerfile.parent / ".dockerignore"
            if not dockerignore.is_file():
                failures.append(f"{dockerfile.parent}: container build context must have .dockerignore")
                continue

            lines = [
                line.strip()
                for line in read_text(dockerignore).splitlines()
                if line.strip() and not line.lstrip().startswith("#")
            ]
            # Compose already forces build contexts under containers/. The
            # matching .dockerignore keeps each context deny-by-default, so
            # adding a helper file beside a Dockerfile does not automatically
            # send it into the image build.
            if not lines or lines[0] not in {"*", "**"}:
                failures.append(f"{dockerignore}: first active pattern must deny the build context")
            if "!Dockerfile" not in lines:
                failures.append(f"{dockerignore}: must explicitly include Dockerfile")

        if failures:
            self.fail("\n".join(failures))

    def test_foundry_image_and_bootstrapped_solc_are_pinned_to_repo_toolchain(self) -> None:
        refs = self.pinned_image_refs(FOUNDRY_IMAGE)
        self.assertGreaterEqual(len(refs), 2, "expected shared Foundry and dependency-stage images")

        expected = refs[0].reference
        for ref in refs:
            with self.subTest(path=str(ref.path)):
                self.assertNotEqual("latest", ref.tag, f"{ref.path}: Foundry image must not use latest")
                self.assertEqual(expected, ref.reference, f"{ref.path}: Foundry image pin drifted")

        expected_solc = self.foundry_toml_solc_version()
        actual_solc = self.dockerfile_solc_version(repo_path("containers/foundry/Dockerfile"))
        self.assertEqual(expected_solc, actual_solc, "containers/foundry/Dockerfile SOLC_VERSION must match dapps/foundry.toml")

    def pinned_image_refs(self, image: str) -> list[PinnedImageRef]:
        refs: list[PinnedImageRef] = []
        for path in iter_files("containers"):
            if path.name != "Dockerfile":
                continue

            text = read_text(path)
            if image not in text:
                continue

            tag, digest = self.parse_pinned_image_from(text, image, str(path))
            refs.append(PinnedImageRef(path=path, image=image, tag=tag, digest=digest))

        return sorted(refs, key=lambda ref: str(ref.path))

    def parse_pinned_image_from(self, text: str, image: str, path_label: str) -> tuple[str, str]:
        match = self.pinned_image_re(image).search(text)
        if match is not None:
            return match.group("tag"), match.group("digest")

        if self.unpinned_image_re(image).search(text):
            self.fail(f"{path_label}: {image} image must include a non-latest tag and sha256 digest")

        self.fail(f"{path_label}: missing {image} image")

    def pinned_image_re(self, image: str) -> re.Pattern[str]:
        return re.compile(
            rf"^FROM\s+{re.escape(image)}:(?P<tag>[^@\s]+)@sha256:(?P<digest>[0-9a-f]{{64}})$",
            re.MULTILINE,
        )

    def unpinned_image_re(self, image: str) -> re.Pattern[str]:
        return re.compile(rf"^FROM\s+{re.escape(image)}(?::[^\s@]+)?(?:\s|$)", re.MULTILINE)

    def foundry_toml_solc_version(self) -> str:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        version = config["profile"]["default"]["solc"]
        self.assertIsInstance(version, str)
        return version

    def dockerfile_solc_version(self, path: Path) -> str:
        return self.parse_solc_arg(read_text(path), str(path))

    def parse_solc_arg(self, text: str, path_label: str) -> str:
        match = SOLC_ARG_RE.search(text)
        if match is None:
            self.fail(f"{path_label}: missing pinned ARG SOLC_VERSION=x.y.z")

        return match.group("version")

    def image_reference_files(self) -> list[Path]:
        return [
            *[path for path in iter_files("containers") if path.name == "Dockerfile"],
            *self.compose_files(),
        ]

    def compose_files(self) -> list[Path]:
        return [path for path in iter_files("compose") if path.suffix in {".yml", ".yaml"}]

    def dockerfile_from_images(self, text: str) -> list[tuple[int, str]]:
        return [
            (text.count("\n", 0, match.start()) + 1, match.group("image"))
            for match in DOCKERFILE_FROM_RE.finditer(text)
        ]

    def compose_images(self, text: str) -> list[tuple[int, str]]:
        return [
            (text.count("\n", 0, match.start()) + 1, match.group("image"))
            for match in COMPOSE_IMAGE_RE.finditer(text)
        ]

    def compose_build_contexts(self, text: str) -> list[tuple[int, str]]:
        return [
            (text.count("\n", 0, match.start()) + 1, match.group("context"))
            for match in COMPOSE_BUILD_CONTEXT_RE.finditer(text)
        ]

    def compose_build_dockerfiles(self, text: str) -> list[tuple[int, str]]:
        return [
            (text.count("\n", 0, match.start()) + 1, match.group("dockerfile"))
            for match in COMPOSE_BUILDFILE_RE.finditer(text)
        ]

    def is_pinned_image_reference(self, image: str) -> bool:
        return PINNED_IMAGE_REF_RE.fullmatch(image) is not None and ":latest@" not in image
