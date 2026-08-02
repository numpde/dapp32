from __future__ import annotations

import unittest

from .common import (
    compose_command_text,
    compose_mapping,
    compose_service,
    compose_volume,
    read_text,
    rendered_compose_config,
    repo_path,
)
from .release_posture import (
    assert_deployment_authority_split,
    assert_offline_read_only_release_check,
    assert_receipt_gated_verification,
    assert_release_output_directions,
    assert_verification_has_no_signing_authority,
    assert_verification_snapshot_boundary,
)


CHECK = "compose/bike-nft/release/check.yml"
DEPLOY = "compose/bike-nft/release/deploy.yml"
VERIFY = "compose/bike-nft/release/verify.yml"


class BikeNftReleasePostureTest(unittest.TestCase):
    def test_release_check_is_offline_and_read_only(self) -> None:
        service = compose_service(rendered_compose_config(CHECK), "bike-nft-release-check")
        assert_offline_read_only_release_check(self, service)
        self.assertIn("tools/bike-nft-release/tsconfig.json", compose_command_text(service))

    def test_deployment_authority_is_split_by_phase(self) -> None:
        config = rendered_compose_config(DEPLOY)
        plan = compose_service(config, "bike-nft-release-plan")
        signer = compose_service(config, "deploy-bike-nft-release")
        artifact = compose_service(config, "bike-nft-release-artifact")

        assert_deployment_authority_split(
            self,
            compose_mapping(config, "services"),
            planner_name="bike-nft-release-plan",
            signer_name="deploy-bike-nft-release",
            materializer_name="bike-nft-release-artifact",
            signing_proxy_name="bike-nft-release-rpc-proxy",
            materializer_proxy_name="bike-nft-release-artifact-rpc-proxy",
        )
        assert_release_output_directions(
            self,
            planner=plan,
            signer=signer,
            materializer=artifact,
            plan_target="/release-plan",
            broadcast_target="/release-broadcast",
            artifact_target="/release-artifact",
        )
        self.assertEqual({"bike_nft_release_deploy_internal": None}, signer["networks"])
        self.assertEqual({"bike_nft_release_artifact_internal": None}, artifact["networks"])

        signer_command = compose_command_text(signer)
        self.assertNotIn("release-plan.args", signer_command)
        self.assertEqual("/release-plan/release-plan.json", compose_mapping(signer, "environment")["BIKE_NFT_RELEASE_PLAN_PATH"])
        self.assertIn("PRIVATE_KEY=", signer_command)
        self.assertNotIn("export PRIVATE_KEY", signer_command)

    def test_verification_is_read_only_and_receipt_gated(self) -> None:
        config = rendered_compose_config(VERIFY)
        input_check = compose_service(config, "bike-nft-release-verify-input")
        provenance = compose_service(config, "bike-nft-release-verify-provenance")
        verifier = compose_service(config, "verify-bike-nft-release")

        assert_receipt_gated_verification(
            self,
            input_service=input_check,
            input_service_name="bike-nft-release-verify-input",
            provenance_service=provenance,
            provenance_service_name="bike-nft-release-verify-provenance",
            verifier_service=verifier,
        )
        assert_verification_snapshot_boundary(
            self,
            input_service=input_check,
            downstream_services=(provenance, verifier),
            external_artifact_target="/deployment/deployment.json",
            snapshot_target="/out",
        )
        assert_verification_has_no_signing_authority(
            self,
            compose_mapping(config, "services"),
        )

        external_artifact = compose_volume(input_check, "/deployment/deployment.json")
        self.assertIn(external_artifact["bind"], ({}, {"create_host_path": False}))
        verified_input = compose_volume(input_check, "/out")
        self.assertEqual("bike_nft_release_verified", verified_input["source"])

        rendered = str(config)
        self.assertNotIn("deployment.args", rendered)
        self.assertNotIn("DEPLOYMENT_ARGUMENTS", rendered)

    def test_make_entrypoints_require_clean_snapshotted_source_and_protected_files(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy = source[source.index("bike-nft-release-deploy:"):source.index("bike-nft-release-verify:")]
        verify = source[source.index("bike-nft-release-verify:"):]
        self.assertIn("CONFIRM_BIKE_NFT_RELEASE_DEPLOY", deploy)
        self.assertIn(
            'require_protected_release_file "$$RPC_URL_FILE" "RPC_URL_FILE" "$$RPC_URL_FILE"',
            deploy,
        )
        self.assertIn(
            'require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"',
            deploy,
        )
        self.assertIn('validate_new_release_output "$$output_dir" "BIKE_NFT_RELEASE_OUTPUT_DIR"', deploy)
        self.assertIn(
            'require_protected_release_file "$$RPC_URL_FILE" "RPC_URL_FILE" "RPC_URL_FILE"',
            verify,
        )
        self.assertIn(
            'require_release_file "$$BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE" "BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE"',
            verify,
        )
        for target in (deploy, verify):
            self.assertLess(target.index("trap cleanup EXIT"), target.index("$(release_snapshot_allocate)"))
            self.assertLess(target.index("$(release_snapshot_allocate)"), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("$(release_snapshot_populate)"), target.index("compose_release_dependencies run --build --rm soldeer-verify"))
            self.assertLess(target.index("compose_release_dependencies run --build --rm soldeer-verify"), target.index("up --build --abort"))
            self.assertIn('-f "$$ceremony_source/$$release_compose_file"', target)

        self.assertLess(deploy.index("compose_release_dependencies run"), deploy.index("compose_release_check run"))
        self.assertLess(deploy.index("compose_release_check run"), deploy.index('mkdir --mode=0700 -- "$$output_dir"'))
        self.assertLess(deploy.index('mkdir --mode=0700 -- "$$output_dir"'), deploy.index("up --build --abort"))


if __name__ == "__main__":
    unittest.main()
