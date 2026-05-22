from __future__ import annotations

import re
import tomllib
import unittest
from dataclasses import dataclass
from pathlib import Path

from .common import iter_files, read_text, repo_path


FOUNDRY_IMAGE = "ghcr.io/foundry-rs/foundry"
FOUNDRY_FROM_RE = re.compile(
    rf"^FROM\s+{re.escape(FOUNDRY_IMAGE)}:(?P<tag>[^@\s]+)@sha256:(?P<digest>[0-9a-f]{{64}})$",
    re.MULTILINE,
)
UNPINNED_FOUNDRY_RE = re.compile(rf"^FROM\s+{re.escape(FOUNDRY_IMAGE)}(?::[^\s@]+)?(?:\s|$)", re.MULTILINE)
SOLC_ARG_RE = re.compile(r"^ARG\s+SOLC_VERSION=(?P<version>[0-9]+\.[0-9]+\.[0-9]+)$", re.MULTILINE)


@dataclass(frozen=True)
class FoundryImageRef:
    path: Path
    tag: str
    digest: str

    @property
    def reference(self) -> str:
        return f"{FOUNDRY_IMAGE}:{self.tag}@sha256:{self.digest}"


class ToolchainVersionTest(unittest.TestCase):
    def test_foundry_dockerfiles_use_the_same_pinned_image(self) -> None:
        refs = self.foundry_image_refs()
        self.assertGreaterEqual(len(refs), 2, "expected shared Foundry and dependency-stage images")

        expected = refs[0].reference
        for ref in refs:
            with self.subTest(path=str(ref.path)):
                self.assertNotEqual("latest", ref.tag, f"{ref.path}: Foundry image must not use latest")
                self.assertEqual(expected, ref.reference, f"{ref.path}: Foundry image pin drifted")

    def test_foundry_image_classifier_self_check(self) -> None:
        pinned = f"FROM {FOUNDRY_IMAGE}:v1.7.1@sha256:{'a' * 64}"
        self.assertEqual(("v1.7.1", "a" * 64), self.parse_foundry_from(pinned, "pinned-fixture"))

        rejected = [
            f"FROM {FOUNDRY_IMAGE}:latest@sha256:{'a' * 64}",
            f"FROM {FOUNDRY_IMAGE}:v1.7.1",
            f"FROM {FOUNDRY_IMAGE}@sha256:{'a' * 64}",
        ]
        for dockerfile in rejected:
            with self.subTest(dockerfile=dockerfile):
                with self.assertRaises(AssertionError):
                    tag, _digest = self.parse_foundry_from(dockerfile, "rejected-fixture")
                    self.assertNotEqual("latest", tag)

    def test_bootstrapped_solc_matches_foundry_toml(self) -> None:
        expected = self.foundry_toml_solc_version()
        actual = self.dockerfile_solc_version(repo_path("containers/foundry/Dockerfile"))

        self.assertEqual(expected, actual, "containers/foundry/Dockerfile SOLC_VERSION must match foundry.toml")

    def test_solc_arg_classifier_self_check(self) -> None:
        self.assertEqual("0.8.35", self.parse_solc_arg("ARG SOLC_VERSION=0.8.35", "pinned-fixture"))

        rejected = [
            "ARG SOLC_VERSION=latest",
            "ARG SOLC_VERSION=${SOLC_VERSION}",
            "# ARG SOLC_VERSION=0.8.35",
        ]
        for dockerfile in rejected:
            with self.subTest(dockerfile=dockerfile):
                with self.assertRaises(AssertionError):
                    self.parse_solc_arg(dockerfile, "rejected-fixture")

    def foundry_image_refs(self) -> list[FoundryImageRef]:
        refs: list[FoundryImageRef] = []
        for path in iter_files("containers"):
            if path.name != "Dockerfile":
                continue

            text = read_text(path)
            if FOUNDRY_IMAGE not in text:
                continue

            tag, digest = self.parse_foundry_from(text, str(path))
            refs.append(FoundryImageRef(path=path, tag=tag, digest=digest))

        return sorted(refs, key=lambda ref: str(ref.path))

    def parse_foundry_from(self, text: str, path_label: str) -> tuple[str, str]:
        match = FOUNDRY_FROM_RE.search(text)
        if match is not None:
            return match.group("tag"), match.group("digest")

        if UNPINNED_FOUNDRY_RE.search(text):
            self.fail(f"{path_label}: Foundry image must include a non-latest tag and sha256 digest")

        self.fail(f"{path_label}: missing Foundry image")

    def foundry_toml_solc_version(self) -> str:
        config = tomllib.loads(read_text(repo_path("foundry.toml")))
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
