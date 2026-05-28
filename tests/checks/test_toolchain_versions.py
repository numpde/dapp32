from __future__ import annotations

import re
import tomllib
import unittest
from dataclasses import dataclass
from pathlib import Path

from .common import iter_files, read_text, repo_path


FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry"
SOLC_ARG_RE = re.compile(r"^ARG\s+SOLC_VERSION=(?P<version>[0-9]+\.[0-9]+\.[0-9]+)$", re.MULTILINE)


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
