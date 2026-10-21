from __future__ import annotations

import unittest

from ..common import read_text, repo_path


class ReleaseHostGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = read_text(repo_path("Makefile"))
        starts = {
            name: cls.source.index(f"{name}:")
            for name in (
                "escrow/release/deploy",
                "escrow/release/verify",
                "bike-nft/release/deploy",
                "bike-nft/release/verify",
                "pay-to-play/release/deploy",
                "pay-to-play/release/verify",
            )
        }
        cls.targets = {name: cls.source[start:].split("\n\n", 1)[0] for name, start in starts.items()}

    def test_common_release_guards_have_one_implementation(self) -> None:
        self.assertEqual(1, self.source.count("define release_require_clean_source"))
        self.assertEqual(1, self.source.count("define release_host_guard_functions"))
        self.assertEqual(1, self.source.count("git status --porcelain --untracked-files=all"))
        self.assertEqual(1, self.source.count("GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify HEAD"))
        for definition in (
            "reject_release_path_symlinks()",
            "require_release_file()",
            "require_protected_release_file()",
            "require_release_rpc_input()",
            "validate_new_release_output()",
            "recheck_new_release_output()",
        ):
            self.assertEqual(1, self.source.count(definition), definition)

    def test_all_release_targets_invoke_common_guards_before_snapshotting(self) -> None:
        labels = {
            "escrow/release/deploy": "Escrow release deployment",
            "escrow/release/verify": "Escrow release verification",
            "bike-nft/release/deploy": "Bike NFT release deployment",
            "bike-nft/release/verify": "Bike NFT release verification",
            "pay-to-play/release/deploy": "Pay-to-Play release deployment",
            "pay-to-play/release/verify": "Pay-to-Play release verification",
        }
        executions = {
            "deploy": "$(call release_deploy_execution,",
            "verify": "$(release_verify_execution)",
        }
        for name, target in self.targets.items():
            execution = executions[name.rsplit("/", 1)[1]]
            source_guard = f"$(call release_require_clean_source,{labels[name]})"
            self.assertIn(source_guard, target)
            self.assertIn("$(release_host_guard_functions)", target)
            self.assertLess(target.index(source_guard), target.index(execution))
            self.assertLess(target.index("$(release_host_guard_functions)"), target.index(execution))
            self.assertLess(target.index("require_release_rpc_input"), target.index(execution))
        prepare = self.source.split("define release_prepare_snapshot\n", 1)[1].split("endef", 1)[0]
        self.assertIn("$(release_snapshot_populate)", prepare)
        for definition in ("release_deploy_execution", "release_verify_execution"):
            execution = self.source.split(f"define {definition}\n", 1)[1].split("endef", 1)[0]
            operation = {
                "release_deploy_execution": "release_approval_prepare",
                "release_verify_execution": "up --build --abort",
            }[definition]
            self.assertLess(execution.index("$(release_prepare_snapshot)"), execution.index(operation))

    def test_deploy_output_is_rechecked_before_creation(self) -> None:
        for name, label in (
            ("escrow/release/deploy", "ESCROW_RELEASE_OUTPUT_DIR"),
            ("bike-nft/release/deploy", "BIKE_NFT_RELEASE_OUTPUT_DIR"),
            ("pay-to-play/release/deploy", "PAY_TO_PLAY_RELEASE_OUTPUT_DIR"),
        ):
            target = self.targets[name]
            initial = f'validate_new_release_output "$$output_dir" "{label}"'
            self.assertLess(target.index(initial), target.index(f"$(call release_deploy_execution,{label})"))
        execution = self.source.split("define release_deploy_execution\n", 1)[1].split("endef", 1)[0]
        recheck = 'recheck_new_release_output "$$output_dir" "$(1)"'
        mkdir = 'mkdir --mode=0700 -- "$$output_dir"'
        self.assertLess(execution.index("compose_release_check run"), execution.index(recheck))
        self.assertLess(execution.index("release_approval_require_deployer"), execution.index(mkdir))
        self.assertLess(execution.index(recheck), execution.index(mkdir))
        self.assertLess(execution.index(mkdir), execution.index("release_approval_prepare"))
        self.assertLess(execution.index("release_approval_prepare"), execution.index("release_approval_run"))

    def test_project_identity_is_announced_before_candidate_code_can_write_output(self) -> None:
        allocate = self.source.split("define release_snapshot_allocate\n", 1)[1].split("endef", 1)[0]
        self.assertIn("Release container project:", allocate)
        self.assertLess(allocate.index('ceremony_project='), allocate.index("Release container project:"))
        prepare = self.source.split("define release_prepare_snapshot\n", 1)[1].split("endef", 1)[0]
        self.assertLess(prepare.index("$(release_snapshot_allocate)"), prepare.index("$(release_snapshot_populate)"))
        self.assertLess(prepare.index("$(release_snapshot_allocate)"), prepare.index("compose_release_dependencies run"))


if __name__ == "__main__":
    unittest.main()
