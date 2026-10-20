from __future__ import annotations

import re
import tomllib
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from tools.json_policy import read_strict_json

from .common import (
    SERVICE_PAYMENT_SNAPSHOT_ROOT,
    is_skipped,
    iter_repo_text_files,
    path_has_symlink,
    read_text,
    repo_path,
)


FORBIDDEN_NAME_PATTERNS = [
    re.compile("dapp" + "32", re.IGNORECASE),
]

ALLOWED_FORBIDDEN_NAME_LITERALS = (
    # External repository addresses are required as publication URLs, not prose branding.
    "https://numpde.github.io/dapp" + "32/",
    "https://raw.githubusercontent.com/numpde/dapp" + "32/",
    # Preserve this captured evidence filename; it is not a product label.
    "/tmp/dapp" + "32-multiparty-fields-20261012/movie-final-state.json",
)

# These exact historical identifiers belong to the recording note, not product branding.
ALLOWED_RECORDED_ARTIFACT_PATHS = {
    # Preserve the exact provenance text in the independently pinned peer vector.
    repo_path("tests/fixtures/pay-to-play/p2p_invoice_codec_v1.json"): ("dapp" + "32 owner",),
    repo_path("notes/017_escrow_walkthrough_recording.txt"): tuple(
        "/tmp/dapp" + "32-walkthrough-" + suffix
        for suffix in (
            "record-original.mjs",
            "record.mjs",
            "recover.mjs",
            "validate.mjs",
            "cleanup.mjs",
            "output",
            "output/evidence.json",
            "output/recording-attempt.json",
            "output/escrow-multiparty-20261013.webm",
            "output/documents/terms.txt",
            "output/documents/submission.txt",
            "output/frames/",
            "output/decoded-0.jpg",
            "output/decoded-1.jpg",
            "output/decoded-2.jpg",
            "record.log",
            "recover.log",
            "validate.log",
            "cleanup.log",
        )
    ),
}

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
MAKE_TARGET_RE = re.compile(r"^(?P<name>[A-Za-z0-9_/-]+)\s*:(?![=])")
MAKE_TARGET_WITH_PREREQS_RE = re.compile(r"^(?P<name>[A-Za-z0-9_/-]+)\s*:(?![=])\s*(?P<prereqs>.*)$")
MAKE_HELP_TARGET_RE = re.compile(r"\bmake\s+(?P<name>[A-Za-z0-9_/-]+)\b")
MAKE_PHONY_RE = re.compile(r"^\.PHONY:\s*(?P<names>.*)$", re.MULTILINE)
MAKE_DEFAULT_GOAL_RE = re.compile(r"^\.DEFAULT_GOAL\s*:?=\s*(?P<name>[A-Za-z0-9_/-]+)\s*$", re.MULTILINE)
PACKAGE_CI_PREREQS = (
    "js/tests",
    "viewer/terminal/check",
    "cam/publication/preflight/check",
    "cam/integration/fuzz/check",
    "bike-nft/release/check",
    "escrow/release/check",
    "pay-to-play/release/check",
    "pay-to-play/refunds/check",
)
FIRST_PARTY_PYTHON_ROOTS = ("containers", "tests", "tools")


class RepositoryHygieneTest(unittest.TestCase):
    def verified_research_source_paths(self) -> tuple[Path, ...]:
        root = SERVICE_PAYMENT_SNAPSHOT_ROOT
        self.assertFalse(path_has_symlink(root), "research snapshot must not use symlinks")
        self.assertTrue(root.is_dir(), "research snapshot must be a directory")
        provenance = root / "provenance.json"
        self.assertFalse(provenance.is_symlink(), "research provenance must not use a symlink")
        entries = read_strict_json(provenance)["files"]
        expected = {provenance}
        sources: list[Path] = []
        for entry in entries:
            relative = Path(entry["path"])
            self.assertFalse(relative.is_absolute(), "research source path must be relative")
            self.assertNotIn("..", relative.parts, "research source path must stay inside snapshot")
            self.assertEqual(relative.as_posix(), entry["path"])
            source = root / relative
            self.assertNotIn(source, expected, "duplicate research source path")
            self.assertFalse(path_has_symlink(source), "research source must not use symlinks")
            self.assertTrue(source.is_file(), f"research source is not a regular file: {relative}")
            contents = source.read_bytes()
            self.assertEqual(len(contents), entry["bytes"], f"research source size: {relative}")
            self.assertEqual(sha256(contents).hexdigest(), entry["sha256"], f"research source checksum: {relative}")
            expected.add(source)
            sources.append(source)
        actual = set()
        for path in root.rglob("*"):
            self.assertFalse(path.is_symlink(), "research snapshot must not use symlinks")
            self.assertTrue(path.is_dir() or path.is_file(), "research snapshot must contain regular files")
            if path.is_file():
                actual.add(path)
        self.assertEqual(actual, expected, "research snapshot files must match provenance")
        return tuple(sources)

    def test_research_snapshot_rejects_modified_source_bytes(self) -> None:
        source = SERVICE_PAYMENT_SNAPSHOT_ROOT / (
            "abstract-packages/"
            "packages/contracts/src/AbstractStreamChannel.sol"
        )
        original = Path.read_bytes

        def altered_bytes(path: Path) -> bytes:
            contents = original(path)
            return contents.replace(b"pragma", b"Pragma", 1) if path == source else contents

        with patch.object(Path, "read_bytes", altered_bytes):
            with self.assertRaisesRegex(AssertionError, "research source checksum"):
                self.verified_research_source_paths()

    def test_research_snapshot_rejects_paths_outside_inventory(self) -> None:
        root = SERVICE_PAYMENT_SNAPSHOT_ROOT
        provenance = read_strict_json(root / "provenance.json")
        for path in ("../outside.sol", "/outside.sol", "abstract-packages/../outside.sol"):
            with self.subTest(path=path):
                entry = dict(provenance["files"][0], path=path)
                with patch(__name__ + ".read_strict_json", return_value={"files": [entry]}):
                    with self.assertRaises(AssertionError):
                        self.verified_research_source_paths()
        with patch(__name__ + ".read_strict_json", return_value={"files": provenance["files"][:-1]}):
            with self.assertRaisesRegex(AssertionError, "must match provenance"):
                self.verified_research_source_paths()

    def test_foundry_file_permissions_are_exact_release_inputs(self) -> None:
        config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        self.assertEqual(
            [
                {"access": "read", "path": "./bike-nft/cam/main.json"},
                {"access": "read", "path": "./escrow/cam/main.json"},
                {"access": "read", "path": "./pay-to-play/cam/main.json"},
                {"access": "read", "path": "/out/deployment.json"},
                {"access": "read", "path": "/release-plan/release-plan.json"},
            ],
            config["profile"]["default"]["fs_permissions"],
        )

    def test_forbidden_text_patterns_are_absent(self) -> None:
        research_sources = self.verified_research_source_paths()
        self.assert_no_matches(
            FORBIDDEN_NAME_PATTERNS, "forbidden project name", ALLOWED_FORBIDDEN_NAME_LITERALS,
            allowed_artifact_paths=ALLOWED_RECORDED_ARTIFACT_PATHS,
            additional_paths=research_sources,
        )
        markers = [re.compile(re.escape(marker)) for marker in LICENSE_MARKERS]
        research_license_lines = {
            path: tuple(
                line for line in path.read_text(encoding="utf-8").splitlines()
                if any(marker in line for marker in LICENSE_MARKERS)
            )
            for path in research_sources
        }
        self.assert_no_matches(
            markers, "license marker", (),
            allowed_artifact_paths=research_license_lines,
            additional_paths=research_sources,
        )
        self.assert_no_matches(SECRET_PATTERNS, "secret pattern", (), additional_paths=research_sources)

    def test_research_notices_and_specs_retain_branding_and_secret_checks(self) -> None:
        root = SERVICE_PAYMENT_SNAPSHOT_ROOT
        for source in (root / "microraiden/LICENSE", root / "raiden-spec/service_contracts.rst"):
            for text, reason in (("dapp" + "32 product", "forbidden project name"),
                                 ("GITHUB_" + "ACCESS_TOKEN", "secret pattern")):
                with self.subTest(source=source, reason=reason), patch(
                    __name__ + ".iter_repo_text_files", return_value=[]
                ), patch(__name__ + ".read_text", return_value=text), patch.object(
                    self, "verified_research_source_paths", return_value=(source,)
                ):
                    with self.assertRaisesRegex(AssertionError, reason):
                        self.test_forbidden_text_patterns_are_absent()

    def test_recorded_artifact_paths_are_admitted_only_as_exact_note_references(self) -> None:
        artifact = "/tmp/dapp" + "32-walkthrough-record.mjs"
        note = repo_path("notes/017_escrow_walkthrough_recording.txt")
        for reference in (artifact, f'"{artifact}"', f"--volume {artifact}:/validation.mjs:ro"):
            with self.subTest(reference=reference), patch(
                __name__ + ".iter_repo_text_files", return_value=[note]
            ), patch(__name__ + ".read_text", return_value=reference), patch.object(
                self, "verified_research_source_paths", return_value=()
            ):
                self.test_forbidden_text_patterns_are_absent()

    def test_recorded_artifact_exceptions_do_not_hide_branding_or_other_hygiene_failures(self) -> None:
        artifact = "/tmp/dapp" + "32-walkthrough-record.mjs"
        note = repo_path("notes/017_escrow_walkthrough_recording.txt")
        for path, text, reason in (
            (repo_path("README.md"), artifact, "forbidden project name"),
            (note, artifact + ".other", "forbidden project name"),
            (note, artifact + "/other", "forbidden project name"),
            (note, "prefix" + artifact, "forbidden project name"),
            (note, "https://numpde.github.io/dapp" + "32/" + artifact, "forbidden project name"),
            (note, "/tmp/dapp" + "32-walkthrough-unknown.mjs", "forbidden project name"),
            (note, artifact + " dapp" + "32 product", "forbidden project name"),
            (note, artifact + " GITHUB_" + "ACCESS_TOKEN", "secret pattern"),
            (note, artifact + " SPDX-" + "License-Identifier", "license marker"),
        ):
            with self.subTest(path=path, text=text), patch(
                __name__ + ".iter_repo_text_files", return_value=[path]
            ), patch(__name__ + ".read_text", return_value=text), patch.object(
                self, "verified_research_source_paths", return_value=()
            ):
                with self.assertRaisesRegex(AssertionError, reason):
                    self.test_forbidden_text_patterns_are_absent()

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
        self.assertEqual(targets, advertised)

    def test_make_scoped_targets_are_hierarchical(self) -> None:
        targets = self.make_targets(read_text(repo_path("Makefile")))
        for target in targets - {"help", "tests", "ci"}:
            with self.subTest(target=target):
                self.assertRegex(target, r"^[a-z0-9]+(?:-[a-z0-9]+)*(?:/[a-z0-9]+(?:-[a-z0-9]+)*)+$")

    def test_make_test_scopes_run_their_supported_campaigns(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        self.assertEqual(
            ("dapps/tests/unit-scenario", "dapps/tests/fuzz", "dapps/tests/invariant"),
            self.make_target_prereqs(makefile, "dapps/tests"),
        )
        self.assertEqual(
            ("tests/checks", "dapps/tests", "js/ci", "tests/live", "cast/offline/check", "wallet/addresses/check",
             "pay-to-play/local/recovery/run", "escrow/local/scenario/run", "bike-nft/local/integration/fuzz/run",
             "bike-nft/local/integration/fuzz/fixture-writes/run", "release/local/rehearsal/check"),
            self.make_target_prereqs(makefile, "tests"),
        )
        for target in ("dapps/tests", "tests"):
            self.assertEqual("", self.make_target_recipe(makefile, target).strip())
        help_recipe = self.make_help_recipe(makefile)
        self.assertIn("external network", help_recipe)
        self.assertIn("disposable fixture", help_recipe)

    def test_repository_has_one_make_entrypoint(self) -> None:
        make_entrypoints = [
            name for name in ["GNUmakefile", "makefile", "Makefile"] if repo_path(name).exists()
        ]

        # GNU Make silently prefers GNUmakefile, then makefile, over Makefile.
        # A second root entrypoint can therefore bypass the operator contract
        # and the checks that intentionally inspect Makefile.
        self.assertEqual(["Makefile"], make_entrypoints)

    def test_format_target_only_mounts_staging_output_writable(self) -> None:
        recipe = self.make_target_recipe(read_text(repo_path("Makefile")), "dapps/format")

        # Forge must finish formatting a temporary copy before Make applies
        # results. The formatter container must never receive repository write
        # authority, or a parse failure can leave a partially formatted dapp.
        self.assertIn('--volume "$$format_stage_dir:/format-output:rw"', recipe)
        self.assertEqual(1, recipe.count("--volume "))
        self.assertNotIn(":/work/dapps/", recipe)

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
        self.assertEqual(targets, phony_targets)

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

        # `js/ci` is the JS/package confidence lane. It should stay a thin
        # Make aggregation over package tests plus package-backed tool checks,
        # not a parallel Compose service or a stale subset of tool smoke tests.
        self.assertEqual(PACKAGE_CI_PREREQS, self.make_target_prereqs(makefile, "js/ci"))

    def test_closed_abi_inventory_does_not_advertise_open_characterization_gaps(self) -> None:
        inventory = read_text(repo_path("notes/012_abi_traversal_inventory.md"))

        # The ABI inventory is now a stop sign against premature abstraction.
        # If it says no gaps remain, it must not also send agents hunting for
        # more characterization before extraction.
        if "No known ABI characterization gaps remain" in inventory:
            self.assertNotIn("deserve characterization before any abstraction", inventory)

    def test_bike_component_admin_does_not_receive_operational_token_roles_by_default(self) -> None:
        source = read_text(repo_path("dapps/bike-nft/src/BicycleComponents.sol"))
        constructor_body = self.solidity_constructor_body(source, "BicycleComponents")

        # The manager is the registry policy boundary. Constructor-time
        # operational role references are suspect regardless of grant helper or
        # local alias; the fixture test owns the positive manager grants.
        self.assertNotIn("MINTER_ROLE", constructor_body)
        self.assertNotIn("TOKEN_URI_SETTER_ROLE", constructor_body)

    def test_bike_manager_admin_does_not_receive_registrar_role_by_default(self) -> None:
        source = read_text(repo_path("dapps/bike-nft/src/BicycleComponentManager.sol"))
        constructor_body = self.solidity_constructor_body(source, "BicycleComponentManager")

        # Registration creates verified component records. Deployment admin can
        # grant registrars, but must not become one through constructor default.
        self.assertNotIn("REGISTRAR_ROLE", constructor_body)

    def test_bike_local_deploy_script_warns_against_live_chain_use(self) -> None:
        source = read_text(repo_path("dapps/bike-nft/script/DeployBikeNftLocal.s.sol"))

        # The local script seeds demo state and uses zero admin delay. Keep the
        # operator-facing comment explicit so it is not mistaken for production
        # deployment guidance.
        self.assertIn("Deploys the bike NFT CAM fixture to the local Anvil lane", source)
        self.assertIn("Do not use it as a live-chain", source)

    def test_compose_project_names_are_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # Compose project/container names are interpolated into many shell
        # environment assignments. Validate the exported values once in the
        # shared lane guard before any Docker-backed recipe reaches Compose.
        self.assertIn("COMPOSE_PROJECT_NAME_VARS := COMPOSE_PROJECT_NAME RPC_COMPOSE_PROJECT_NAME", makefile)
        self.assertIn("export $(COMPOSE_PROJECT_NAME_VARS)", makefile)
        self.assertIn("COMPOSE_PROJECT_NAME_GUARD :=", makefile)
        self.assertIn("must be a Docker-safe name, not a path or shell expression", makefile)
        self.assertIn("$(COMPOSE_PROJECT_NAME_GUARD); $(NON_ROOT_GUARD); $(REPO_SHAPE_GUARD)", makefile)

    def test_local_uid_gid_are_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # LOCAL_UID/GID are interpolated into Compose `user:` values. Read them
        # from exported shell variables and validate them before Compose sees
        # any Make-expanded environment assignment.
        self.assertIn("export LOCAL_UID LOCAL_GID", makefile)
        self.assertIn('uid="$${LOCAL_UID:?missing_LOCAL_UID}"', makefile)
        self.assertIn("LOCAL_UID and LOCAL_GID must be positive decimal integers", makefile)
        self.assertNotIn('"$(LOCAL_UID)" == "0"', makefile)

    def test_dependency_update_flag_is_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # ALLOW_UPDATE selects whether dependency metadata may change. It is
        # also interpolated into dependency Compose environments, so validate it
        # before those recipes reach Compose.
        self.assertIn("export LOCAL_UID LOCAL_GID ALLOW_UPDATE", makefile)
        self.assertIn('ALLOW_UPDATE_GUARD := if [[ "$${ALLOW_UPDATE:?missing_ALLOW_UPDATE}"', makefile)
        self.assertIn("$(ALLOW_UPDATE_GUARD);", self.make_target_recipe(makefile, "dapps/deps/install"))
        self.assertIn("$(ALLOW_UPDATE_GUARD);", self.make_target_recipe(makefile, "dapps/deps/verify"))
        self.assertIn("$(ALLOW_UPDATE_GUARD);", self.make_target_recipe(makefile, "js/deps/install"))
        self.assertNotIn('case "$(ALLOW_UPDATE)"', makefile)

    def test_bike_cam_inputs_are_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # The fixture script computes SHA-256 from its own mounted root bytes.
        # Only the operator-supplied URI crosses Make's shell boundary.
        self.assertIn("export CAM_URI", makefile)
        self.assertNotIn("BIKE_NFT_CAM_HASH", makefile)
        self.assertIn("CAM_URI must be an absolute http(s) or ipfs URI without shell syntax", makefile)
        self.assertNotIn('if [[ -z "$(CAM_URI)" ]]', makefile)
        self.assertIn("$(CAM_URI_GUARD);", self.make_target_recipe(makefile, "bike-nft/local/deploy"))

    def test_viewer_terminal_mock_is_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # The mock selector is a Compose environment value and a tool boundary.
        # Keep it a reviewed label, not a path or shell fragment.
        self.assertIn("export VIEWER_TERMINAL_MOCK", makefile)
        self.assertIn("VIEWER_TERMINAL_MOCK must be a mock name", makefile)
        for target in (
            "viewer/terminal/check",
            "viewer/terminal/mock/up",
            "viewer/terminal/mock/status",
            "viewer/terminal/mock/attach",
            "viewer/terminal/mock/down",
        ):
            with self.subTest(target=target):
                self.assertIn("$(VIEWER_TERMINAL_MOCK_GUARD);", self.make_target_recipe(makefile, target))

    def test_integration_fuzz_descriptor_bind_is_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        recipe = self.make_target_recipe(makefile, "cam/live/integration/fuzz/run")

        # Docker may resolve host symlinks before the container can inspect the
        # bind target, and the external Docker network is an authority boundary.
        # Guard both operator-supplied values before Compose interpolation.
        self.assertIn("export CAM_INTEGRATION_SEED CAM_INTEGRATION_RUNS CAM_INTEGRATION_STEPS", makefile)
        self.assertIn('seed="$${CAM_INTEGRATION_SEED:?missing_CAM_INTEGRATION_SEED}"', makefile)
        self.assertIn("CAM_INTEGRATION_SEED must be 1-128 URL-safe label characters", makefile)
        self.assertNotIn('CAM_INTEGRATION_SEED="$(CAM_INTEGRATION_SEED)"', makefile)
        self.assertIn("$(CAM_INTEGRATION_INPUT_GUARD);", recipe)
        self.assertIn('! -f "$$path"', recipe)
        self.assertIn('-L "$$current"', recipe)
        self.assertIn("must not pass through a symlink", recipe)
        self.assertIn("CAM_INTEGRATION_NETWORK", recipe)
        self.assertIn("^[A-Za-z0-9][A-Za-z0-9_.-]*$$", recipe)
        self.assertIn("must be a Docker network name", recipe)

        for target in (
            "cam/integration/fuzz/check",
            "bike-nft/local/integration/fuzz/run",
            "bike-nft/local/integration/fuzz/fixture-writes/run",
            "bike-nft/local/integration/fuzz/down",
        ):
            with self.subTest(target=target):
                self.assertIn("$(CAM_INTEGRATION_INPUT_GUARD);", self.make_target_recipe(makefile, target))

    def test_package_dependency_manifest_discovery_can_reject_symlinks(self) -> None:
        recipe = self.make_target_recipe(read_text(repo_path("Makefile")), "js/deps/install")

        # The loop below rejects symlinked workspace package manifests. A
        # `find -type f` prefilter would hide those symlinks before the guard.
        self.assertIn("-name package.json | sort", recipe)
        self.assertNotIn("-name package.json -type f", recipe)
        self.assertIn('if [[ -L "$$manifest" ]]; then', recipe)
        self.assertIn('if [[ ! -f "$$manifest" ]]; then', recipe)

    def test_cast_rpc_secret_file_is_guarded_before_docker(self) -> None:
        recipe = self.make_target_recipe(read_text(repo_path("Makefile")), "cast/live/block-number/read")

        # Compose cannot validate the operator's original path after Make has
        # copied it into a temporary secret file. Keep that host-side boundary
        # explicit before the networked RPC lane starts.
        self.assertIn('reject_rpc_url_file_symlinks "$$RPC_URL_FILE"', recipe)
        self.assertIn('-L "$$current"', recipe)
        self.assertIn('-L "$$path"', recipe)
        self.assertIn("RPC_URL_FILE must not pass through a symlink", recipe)

    def test_gui_published_bind_is_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # The GUI lane publishes a host port. Validate operator-provided bind
        # fields before Compose interpolation can reinterpret malformed values.
        self.assertIn("BIKE_NFT_GUI_PORT must be an integer from 1 to 65535", makefile)
        self.assertIn("BIKE_NFT_GUI_BIND_HOST must be localhost or an IPv4 literal", makefile)
        self.assertIn("BIKE_NFT_GUI_ORIGIN must be an http(s) origin", makefile)
        self.assertIn("BIKE_NFT_GUI_ORIGIN port must be an integer from 1 to 65535", makefile)
        self.assertIn("export ANVIL_HOST_PORT BIKE_NFT_GUI_PORT BIKE_NFT_GUI_BIND_HOST BIKE_NFT_GUI_ORIGIN", makefile)
        self.assertIn('origin="$${BIKE_NFT_GUI_ORIGIN:?missing_BIKE_NFT_GUI_ORIGIN}"', makefile)
        self.assertNotIn('origin="$(BIKE_NFT_GUI_ORIGIN)"', makefile)
        self.assertIn("[^:/@", makefile)
        self.assertIn("$(BIKE_NFT_GUI_BIND_GUARD);", self.make_target_recipe(makefile, "bike-nft/local/demo/gui/up"))
        self.assertIn("$(BIKE_NFT_GUI_BIND_GUARD);", self.make_target_recipe(makefile, "bike-nft/local/demo/gui/down"))

    def test_anvil_published_port_is_guarded_before_docker(self) -> None:
        makefile = read_text(repo_path("Makefile"))

        # The host Anvil lane publishes a loopback RPC port. Validate the
        # operator-provided port before Compose interpolation.
        self.assertIn("ANVIL_HOST_PORT must be an integer from 1 to 65535", makefile)
        self.assertIn('port="$${ANVIL_HOST_PORT:?missing_ANVIL_HOST_PORT}"', makefile)
        self.assertNotIn('port="$(ANVIL_HOST_PORT)"', makefile)
        self.assertIn("$(ANVIL_HOST_PORT_GUARD);", self.make_target_recipe(makefile, "anvil/host/up"))
        self.assertIn("$(ANVIL_HOST_PORT_GUARD);", self.make_target_recipe(makefile, "anvil/down"))

    def assert_no_matches(
        self, patterns: list[re.Pattern[str]], label: str, allowed_literals: tuple[str, ...],
        *, allowed_artifact_paths: dict[Path, tuple[str, ...]] | None = None,
        additional_paths: tuple[Path, ...] | None = None,
    ) -> None:
        failures: list[str] = []

        paths = set(iter_repo_text_files())
        if additional_paths is not None:
            paths.update(additional_paths)
        for path in sorted(paths):
            text = read_text(path)
            artifact_pattern = None
            if allowed_artifact_paths is not None and path in allowed_artifact_paths:
                artifact_pattern = re.compile(
                    r"""(?<![^\s"'<>():])(?:"""
                    + "|".join(re.escape(artifact) for artifact in allowed_artifact_paths[path])
                    + r""")(?![^\s"'<>():])"""
                )
            for line_number, line in enumerate(text.splitlines(), start=1):
                line_to_check = line
                if artifact_pattern is not None:
                    line_to_check = artifact_pattern.sub("", line_to_check)
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

    def make_target_recipe(self, makefile: str, target: str) -> str:
        lines = makefile.splitlines()
        for index, line in enumerate(lines):
            match = MAKE_TARGET_RE.match(line)
            if match is not None and match.group("name") == target:
                recipe: list[str] = []
                for recipe_line in lines[index + 1:]:
                    if MAKE_TARGET_RE.match(recipe_line):
                        break
                    recipe.append(recipe_line)
                return "\n".join(recipe)
        self.fail(f"missing Make target: {target}")

    def make_targets(self, makefile: str) -> set[str]:
        return set(self.make_target_list(makefile))

    def make_target_list(self, makefile: str) -> list[str]:
        return [
            match.group("name")
            for line in makefile.splitlines()
            if (match := MAKE_TARGET_RE.match(line)) is not None
        ]

    def solidity_constructor_body(self, source: str, contract_name: str) -> str:
        match = re.search(r"\bconstructor\s*\(", source)
        if match is None:
            self.fail(f"{contract_name} must have a constructor")

        open_brace = source.find("{", match.end())
        if open_brace == -1:
            self.fail(f"{contract_name} constructor body not found")

        depth = 0
        for index in range(open_brace, len(source)):
            char = source[index]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    return source[open_brace + 1:index]

        self.fail(f"{contract_name} constructor body is unterminated")

    def make_target_prereqs(self, makefile: str, target: str) -> tuple[str, ...]:
        for line in makefile.splitlines():
            match = MAKE_TARGET_WITH_PREREQS_RE.match(line)
            if match is not None and match.group("name") == target:
                return tuple(match.group("prereqs").split())
        self.fail(f"missing Make target: {target}")
