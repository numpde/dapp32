from __future__ import annotations

import unittest

from .common import compose_mapping, compose_service, rendered_compose_config
from .release_posture import (
    assert_deployment_authority_split,
    assert_offline_read_only_release_check,
    assert_receipt_gated_verification,
    assert_release_output_directions,
    assert_verification_has_no_signing_authority,
    assert_verification_snapshot_boundary,
)

class PayToPlayReleasePostureTest(unittest.TestCase):
    def test_payments_use_shared_deployment_authority_boundaries(self) -> None:
        config = rendered_compose_config(("compose/release/deploy.yml", "compose/pay-to-play/release/deploy.yml"))
        services = compose_mapping(config, "services")
        assert_deployment_authority_split(self, config, planner_name="release-plan", signer_name="deploy-release",
            materializer_name="release-artifact", signing_proxy_name="release-rpc-proxy", materializer_proxy_name="release-artifact-rpc-proxy")
        assert_release_output_directions(self, planner=services["release-plan"], signer=services["deploy-release"],
            materializer=services["release-artifact"], plan_target="/release-plan", broadcast_target="/release-broadcast", artifact_target="/release-artifact")
        for name in ("release-plan", "deploy-release"):
            env = compose_mapping(services[name], "environment")
            self.assertEqual("0", env["PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD"])
            self.assertNotEqual(env["PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER"], env["PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN"])
        self.assertIn("eth_getTransactionByHash", services["release-artifact-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"])

    def test_verification_is_snapshot_and_receipt_gated_without_signing(self) -> None:
        config = rendered_compose_config(("compose/release/verify.yml", "compose/pay-to-play/release/verify.yml"))
        services = compose_mapping(config, "services")
        assert_receipt_gated_verification(self, input_service=services["verify-input"], input_service_name="verify-input",
            provenance_service=services["verify-provenance"], provenance_service_name="verify-provenance", verifier_service=services["verify-release"])
        assert_verification_snapshot_boundary(self, input_service=services["verify-input"], downstream_services=(services["verify-provenance"], services["verify-release"]),
            external_artifact_target="/deployment/deployment.json", snapshot_target="/out")
        assert_verification_has_no_signing_authority(self, services)

    def test_release_tool_check_is_offline(self) -> None:
        config = rendered_compose_config(("compose/release/check.yml", "compose/pay-to-play/release/check.yml"))
        service = compose_service(config, "release-check")
        assert_offline_read_only_release_check(self, service)
        self.assertEqual("tools/pay-to-play-release", compose_mapping(service, "environment")["RELEASE_TOOL_DIR"])
