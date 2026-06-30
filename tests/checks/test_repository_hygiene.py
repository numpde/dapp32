from __future__ import annotations

import re
import unittest

from .common import is_skipped, iter_repo_text_files, read_text, repo_path


FORBIDDEN_NAME_PATTERNS = [
    re.compile("dapp" + "32", re.IGNORECASE),
]

ALLOWED_FORBIDDEN_NAME_LITERALS = (
    # The site path is an externally visible address, not prose branding.
    "https://numpde.github.io/dapp" + "32/",
)

LICENSE_MARKERS = [
    "SPDX-" + "License-Identifier",
    "Permission is hereby " + "granted",
    "THE SOFTWARE IS " + "PROVIDED",
]

SECRET_PATTERNS = [
    re.compile("GITHUB_" + "ACCESS_TOKEN"),
    re.compile(r"github_pat_[A-Za-z0-9_]+"),
    re.compile(r"ghp_[A-Za-z0-9_]{20,}"),
    re.compile(r"BEGIN [A-Z ]*PRIVATE KEY"),
]
MAKE_TARGET_RE = re.compile(r"^(?P<name>[A-Za-z0-9_-]+)\s*:(?![=])")
MAKE_TARGET_WITH_PREREQS_RE = re.compile(r"^(?P<name>[A-Za-z0-9_-]+)\s*:(?![=])\s*(?P<prereqs>.*)$")
MAKE_HELP_TARGET_RE = re.compile(r"\bmake\s+(?P<name>[A-Za-z0-9_-]+)\b")
MAKE_PHONY_RE = re.compile(r"^\.PHONY:\s*(?P<names>.*)$")
MAKE_DEFAULT_GOAL_RE = re.compile(r"^\.DEFAULT_GOAL\s*:?=\s*(?P<name>[A-Za-z0-9_-]+)\s*$", re.MULTILINE)
PACKAGE_CI_PREREQS = ("package-test", "viewer-terminal-check", "cam-publication-preflight-check")
FIRST_PARTY_PYTHON_ROOTS = ("containers", "tests", "tools")


class RepositoryHygieneTest(unittest.TestCase):
    def test_forbidden_text_patterns_are_absent(self) -> None:
        self.assert_no_matches(FORBIDDEN_NAME_PATTERNS, "forbidden project name", ALLOWED_FORBIDDEN_NAME_LITERALS)
        markers = [re.compile(re.escape(marker)) for marker in LICENSE_MARKERS]
        self.assert_no_matches(markers, "license marker", ())
        self.assert_no_matches(SECRET_PATTERNS, "secret pattern", ())

    def test_js_build_outputs_are_not_materialized_on_host(self) -> None:
        failures: list[str] = []
        # JS workspace builds are validation lanes, not artifact export lanes.
        # Keep outputs in container tmpfs unless an explicit export path is
        # deliberately added. This scans by artifact name instead of workspace
        # shape so new apps/tools cannot accidentally escape the invariant.
        for dist in repo_path("js").rglob("dist"):
            if "node_modules" in dist.relative_to(repo_path("js")).parts:
                continue
            if dist.is_dir():
                failures.append(f"{dist}: JS build output must stay in container tmpfs")

        if failures:
            self.fail("\n".join(failures))

    def test_foundry_outputs_are_not_materialized_on_host(self) -> None:
        failures: list[str] = []
        output_names = {"broadcast", "cache", "out"}

        # Routine Forge lanes set FOUNDRY_* paths to container tmpfs. Exclude
        # Soldeer dependencies: those are installed third-party source trees,
        # and their upstream layout may legitimately contain build metadata.
        for path in repo_path("dapps").rglob("*"):
            relative_parts = path.relative_to(repo_path("dapps")).parts
            if not path.is_dir() or "dependencies" in relative_parts:
                continue
            if path.name in output_names:
                failures.append(f"{path}: Foundry output must stay in container tmpfs")

        if failures:
            self.fail("\n".join(failures))

    def test_first_party_python_bytecode_is_not_materialized_on_host(self) -> None:
        failures: list[str] = []

        # Supported Python lanes disable bytecode writes. If first-party Python
        # leaves pyc artifacts on the host, someone bypassed that boundary or a
        # lane regressed.
        for root_name in FIRST_PARTY_PYTHON_ROOTS:
            root = repo_path(root_name)
            for path in root.rglob("*"):
                if path.is_dir() and path.name == "__pycache__":
                    failures.append(f"{path}: Python bytecode cache must not be materialized on host")
                elif path.is_file() and path.suffix == ".pyc":
                    failures.append(f"{path}: Python bytecode must not be materialized on host")

        if failures:
            self.fail("\n".join(failures))

    def test_first_party_paths_do_not_use_symlinks(self) -> None:
        failures: list[str] = []

        # Docker bind mounts, staged workspaces, and CAM publication tools all
        # reason about repository paths before giving any lane write authority.
        # Keep first-party paths real; dependency/install trees are separate
        # materialized outputs with their own integrity checks.
        for path in repo_path(".").rglob("*"):
            if is_skipped(path):
                continue
            if path.is_symlink():
                failures.append(f"{path}: first-party repository paths must not be symlinks")

        if failures:
            self.fail("\n".join(failures))

    def test_make_help_mentions_existing_targets(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        targets = self.make_targets(makefile)
        advertised = set(MAKE_HELP_TARGET_RE.findall(self.make_help_recipe(makefile)))

        # `make help` is the operator's map of supported entrypoints. If it
        # advertises a stale target, the safest path becomes guesswork.
        self.assertEqual(set(), advertised - targets)

    def test_make_phony_targets_are_real_targets(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        targets = self.make_targets(makefile)
        phony_targets = {
            name
            for match in MAKE_PHONY_RE.finditer(makefile)
            for name in match.group("names").split()
        }

        # Phony declarations are also operator API inventory. A stale `.PHONY`
        # entry makes it harder to review which Make names are real lanes.
        self.assertEqual(set(), phony_targets - targets)

    def test_make_default_goal_is_explicit_help_target(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        match = MAKE_DEFAULT_GOAL_RE.search(makefile)
        if match is None:
            self.fail("Makefile must declare an explicit default goal")

        goal = match.group("name")
        # The default invocation should be safe discovery, not an execution
        # lane. Keep `make` equivalent to `make help`.
        self.assertEqual("help", goal)
        self.assertIn(goal, self.make_targets(makefile))

    def test_make_targets_are_unique(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        targets = self.make_target_list(makefile)
        duplicates = sorted({target for target in targets if targets.count(target) > 1})

        # GNU Make allows later recipes to override earlier ones. That is too
        # implicit for operator lanes; duplicate targets should be reviewed as
        # an intentional refactor instead.
        self.assertEqual([], duplicates)

    def test_package_ci_aggregates_package_backed_tool_checks(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # `package-ci` is the JS/package confidence lane. It should stay a thin
        # Make aggregation over package tests plus package-backed tool checks,
        # not a parallel Compose service or a stale subset of tool smoke tests.
        self.assertEqual(PACKAGE_CI_PREREQS, self.make_target_prereqs(makefile, "package-ci"))

    def assert_no_matches(self, patterns: list[re.Pattern[str]], label: str, allowed_literals: tuple[str, ...]) -> None:
        failures: list[str] = []

        for path in iter_repo_text_files():
            text = read_text(path)
            for line_number, line in enumerate(text.splitlines(), start=1):
                line_to_check = line
                for allowed in allowed_literals:
                    line_to_check = line_to_check.replace(allowed, "")
                if any(pattern.search(line_to_check) for pattern in patterns):
                    failures.append(f"{path}:{line_number}: {label}")

        if failures:
            self.fail("\n".join(failures))

    def make_help_recipe(self, makefile: str) -> str:
        lines = makefile.splitlines()
        start = lines.index("help:") + 1
        recipe: list[str] = []
        for line in lines[start:]:
            if MAKE_TARGET_RE.match(line):
                break
            recipe.append(line)
        return "\n".join(recipe)

    def make_targets(self, makefile: str) -> set[str]:
        return set(self.make_target_list(makefile))

    def make_target_list(self, makefile: str) -> list[str]:
        return [
            match.group("name")
            for line in makefile.splitlines()
            if (match := MAKE_TARGET_RE.match(line)) is not None
        ]

    def make_target_prereqs(self, makefile: str, target: str) -> tuple[str, ...]:
        for line in makefile.splitlines():
            match = MAKE_TARGET_WITH_PREREQS_RE.match(line)
            if match is not None and match.group("name") == target:
                return tuple(match.group("prereqs").split())
        self.fail(f"missing Make target: {target}")
