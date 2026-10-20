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


CHECK = ("compose/release/check.yml", "compose/bike-nft/release/check.yml")
DEPLOY = ("compose/release/deploy.yml", "compose/bike-nft/release/deploy.yml")
VERIFY = ("compose/release/verify.yml", "compose/bike-nft/release/verify.yml")


class BikeNftReleasePostureTest(unittest.TestCase):
    def test_release_check_is_offline_and_read_only(self) -> None:
        service = compose_service(rendered_compose_config(CHECK), "release-check")
        assert_offline_read_only_release_check(self, service)
        self.assertEqual("tools/bike-nft-release", compose_mapping(service, "environment")["RELEASE_TOOL_DIR"])

    def test_deployment_authority_is_split_by_phase(self) -> None:
        config = rendered_compose_config(DEPLOY)
        plan = compose_service(config, "release-plan")
        signer = compose_service(config, "deploy-release")
        artifact = compose_service(config, "release-artifact")

        assert_deployment_authority_split(
            self,
            compose_mapping(config, "services"),
            planner_name="release-plan",
            signer_name="deploy-release",
            materializer_name="release-artifact",
            signing_proxy_name="release-rpc-proxy",
            materializer_proxy_name="release-artifact-rpc-proxy",
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
        self.assertEqual({"release_deploy_internal": None}, signer["networks"])
        self.assertEqual({"release_artifact_internal": None}, artifact["networks"])

        signer_command = compose_command_text(signer)
        self.assertNotIn("release-plan.args", signer_command)
        self.assertEqual("/release-plan/release-plan.json", compose_mapping(signer, "environment")["BIKE_NFT_RELEASE_PLAN_PATH"])
        self.assertIn("PRIVATE_KEY=", signer_command)
        self.assertNotIn("export PRIVATE_KEY", signer_command)

    def test_verification_is_read_only_and_receipt_gated(self) -> None:
        config = rendered_compose_config(VERIFY)
        input_check = compose_service(config, "verify-input")
        provenance = compose_service(config, "verify-provenance")
        verifier = compose_service(config, "verify-release")

        assert_receipt_gated_verification(
            self,
            input_service=input_check,
            input_service_name="verify-input",
            provenance_service=provenance,
            provenance_service_name="verify-provenance",
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
        self.assertEqual("release_verified", verified_input["source"])

        rendered = str(config)
        self.assertNotIn("deployment.args", rendered)
        self.assertNotIn("DEPLOYMENT_ARGUMENTS", rendered)

    def test_make_entrypoints_require_clean_snapshotted_source_and_protected_files(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy = source[source.index("bike-nft/release/deploy:"):source.index("bike-nft/release/verify:")]
        verify = source[source.index("bike-nft/release/verify:"):]
        self.assertIn("CONFIRM_BIKE_NFT_RELEASE_DEPLOY", deploy)
        self.assertIn(
            'require_release_rpc_input',
            deploy,
        )
        self.assertIn(
            'require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"',
            deploy,
        )
        self.assertIn('validate_new_release_output "$$output_dir" "BIKE_NFT_RELEASE_OUTPUT_DIR"', deploy)
        self.assertIn(
            'require_release_rpc_input',
            verify,
        )
        self.assertIn(
            'require_release_file "$$BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE" "BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE"',
            verify,
        )
        self.assertIn("$(call release_deploy_execution,BIKE_NFT_RELEASE_OUTPUT_DIR)", deploy)
        self.assertIn("$(release_verify_execution)", verify)
        self.assertIn("$(call release_snapshot_compose_args,$(call release_compose_files,$(BIKE_NFT_RELEASE_DEPLOY_COMPOSE_FILES),deploy))", deploy)
        self.assertIn("$(call release_snapshot_compose_args,$(call release_compose_files,$(BIKE_NFT_RELEASE_VERIFY_COMPOSE_FILES),verify))", verify)



if __name__ == "__main__":
    unittest.main()
