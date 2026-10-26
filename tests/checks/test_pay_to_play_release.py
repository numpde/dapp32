from __future__ import annotations

import unittest

from .text.test_rendered_compose_posture import makefile_compose_unit, release_deployment_units
from .common import compose_mapping, compose_service, compose_volume, rendered_compose_config
from .release_posture import (
    assert_deployment_authority_split,
    assert_offline_read_only_release_check,
    assert_release_output_directions,
    assert_verification_has_no_signing_authority,
)


RELEASE_ENV = {
    "CONTRACT_RELEASE_APP": "pay-to-play", "UI_RELEASE_APP": "pay-to-play", "CAM_RELEASE_APP": "pay-to-play",
    "RELEASE_APPROVAL_APP": "pay-to-play",
    "CONTRACT_RELEASE_SETTINGS_JSON": '{"intendedPaymentAdmin":"0x0000000000000000000000000000000000000012","nullClaimPeriod":0}',
    "CAM_RELEASE_INTENDED_OWNER": "0x0000000000000000000000000000000000000011",
}


class PayToPlayReleasePostureTest(unittest.TestCase):
    def test_payments_use_shared_deployment_authority_boundaries(self) -> None:
        for operation, role, files in zip(("contracts", "ui", "cam"), ("contract", "ui", "cam"), release_deployment_units()[2::3]):
            with self.subTest(operation=operation):
                config = rendered_compose_config(files, env=RELEASE_ENV)
                services = compose_mapping(config, "services")
                planner_name = "release-reference-prepare" if operation == "cam" else "release-plan"
                assert_deployment_authority_split(self, config, operation=operation, planner_name=planner_name,
                    signer_name="deploy-release", materializer_name="release-artifact",
                    signing_proxy_name="release-rpc-proxy", materializer_proxy_name="release-artifact-rpc-proxy")
                assert_release_output_directions(self, operation=operation, planner=services[planner_name],
                    signer=services["deploy-release"], materializer=services["release-artifact"],
                    publisher=services[f"release-{role}-publish"], plan_target="/release-plan",
                    broadcast_target="/release-broadcast", candidate_target=f"/{role}-candidate", artifact_target=f"/{role}-artifact")
                env = compose_mapping(services[planner_name], "environment")
                if operation == "contracts":
                    self.assertEqual(RELEASE_ENV["CONTRACT_RELEASE_SETTINGS_JSON"], env["CONTRACT_RELEASE_SETTINGS_JSON"])
                    self.assertNotIn("CAM_RELEASE_INTENDED_OWNER", env)
                elif operation == "cam":
                    self.assertEqual(RELEASE_ENV["CAM_RELEASE_INTENDED_OWNER"], env["CAM_RELEASE_INTENDED_OWNER"])
                    self.assertNotIn("CONTRACT_RELEASE_SETTINGS_JSON", env)
                self.assertIn("eth_getTransactionByHash", services["release-artifact-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"])

    def test_verification_uses_immutable_retained_inputs_without_signing(self) -> None:
        for phase, role in (("CONTRACT", "contract"), ("UI", "ui"), ("CAM", "cam")):
            with self.subTest(phase=phase):
                config = rendered_compose_config(makefile_compose_unit(f"{phase}_RELEASE_ARTIFACT_COMPOSE_FILES"), env=RELEASE_ENV)
                services = compose_mapping(config, "services")
                assert_verification_has_no_signing_authority(self, services)
                receipt_evidence = "/approval-audit" if phase == "CAM" else "/release-broadcast"
                targets = ("/release-plan", receipt_evidence, "/reference")
                if phase == "CAM":
                    targets = (*targets, "/root-proof")
                for target in targets:
                    self.assertIs(compose_volume(services["release-artifact"], target)["read_only"], True)
                publisher = services[f"release-{role}-publish"]
                assert_offline_read_only_release_check(self, publisher)
                self.assertIs(compose_volume(publisher, f"/{role}-candidate")["read_only"], True)
                self.assertIsNot(compose_volume(publisher, f"/{role}-artifact").get("read_only"), True)

    def test_release_tool_check_is_offline(self) -> None:
        config = rendered_compose_config(("compose/release/check.yml", "compose/pay-to-play/release/check.yml"))
        service = compose_service(config, "release-check")
        assert_offline_read_only_release_check(self, service)
        self.assertEqual("tools/pay-to-play-release", compose_mapping(service, "environment")["RELEASE_TOOL_DIR"])
