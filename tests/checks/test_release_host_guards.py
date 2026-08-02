from __future__ import annotations

import unittest

from .common import read_text, repo_path


class ReleaseHostGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = read_text(repo_path("Makefile"))
        starts = {
            name: cls.source.index(f"{name}:")
            for name in (
                "escrow-release-deploy",
                "escrow-release-verify",
                "bike-nft-release-deploy",
                "bike-nft-release-verify",
            )
        }
        cls.targets = {
            "escrow-release-deploy": cls.source[starts["escrow-release-deploy"]:starts["escrow-release-verify"]],
            "escrow-release-verify": cls.source[starts["escrow-release-verify"]:starts["bike-nft-release-deploy"]],
            "bike-nft-release-deploy": cls.source[starts["bike-nft-release-deploy"]:starts["bike-nft-release-verify"]],
            "bike-nft-release-verify": cls.source[starts["bike-nft-release-verify"]:],
        }

    def test_common_release_guards_have_one_implementation(self) -> None:
        self.assertEqual(1, self.source.count("define release_require_clean_source"))
        self.assertEqual(1, self.source.count("define release_host_guard_functions"))
        self.assertEqual(1, self.source.count("git status --porcelain --untracked-files=all"))
        self.assertEqual(1, self.source.count("GIT_NO_REPLACE_OBJECTS=1 git rev-parse --verify HEAD"))
        for definition in (
            "reject_release_path_symlinks()",
            "require_release_file()",
            "require_protected_release_file()",
            "validate_new_release_output()",
            "recheck_new_release_output()",
        ):
            self.assertEqual(1, self.source.count(definition), definition)

    def test_all_release_targets_invoke_common_guards_before_snapshotting(self) -> None:
        labels = {
            "escrow-release-deploy": "Escrow release deployment",
            "escrow-release-verify": "Escrow release verification",
            "bike-nft-release-deploy": "Bike NFT release deployment",
            "bike-nft-release-verify": "Bike NFT release verification",
        }
        for name, target in self.targets.items():
            source_guard = f"$(call release_require_clean_source,{labels[name]})"
            self.assertIn(source_guard, target)
            self.assertIn("$(release_host_guard_functions)", target)
            self.assertLess(target.index(source_guard), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("$(release_host_guard_functions)"), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("require_protected_release_file"), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("$(release_snapshot_populate)"), target.index("up --build --abort"))

    def test_deploy_output_is_rechecked_before_creation(self) -> None:
        for name, label in (
            ("escrow-release-deploy", "ESCROW_RELEASE_OUTPUT_DIR"),
            ("bike-nft-release-deploy", "BIKE_NFT_RELEASE_OUTPUT_DIR"),
        ):
            target = self.targets[name]
            initial = f'validate_new_release_output "$$output_dir" "{label}"'
            recheck = f'recheck_new_release_output "$$output_dir" "{label}"'
            mkdir = 'mkdir --mode=0700 -- "$$output_dir"'
            self.assertLess(target.index(initial), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("compose_release_check run"), target.index(recheck))
            self.assertLess(target.index(recheck), target.index(mkdir))
            self.assertLess(target.index(mkdir), target.index("up --build --abort"))


if __name__ == "__main__":
    unittest.main()
