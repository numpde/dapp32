from __future__ import annotations

import unittest

from .text.test_rendered_compose_posture import makefile_compose_unit, release_deployment_units
from .common import compose_command_text, compose_mapping, compose_service, compose_volume, rendered_compose_config
from .release_posture import (
    expanded_release_target,
    assert_deployment_authority_split,
    assert_offline_read_only_release_check,
    assert_release_output_directions,
    assert_verification_has_no_signing_authority,
)


CHECK = ("compose/release/check.yml", "compose/bike-nft/release/check.yml")
RELEASE_ENV = {
    "CONTRACT_RELEASE_APP": "bike-nft", "UI_RELEASE_APP": "bike-nft", "CAM_RELEASE_APP": "bike-nft",
    "RELEASE_APPROVAL_APP": "bike-nft",
}


class BikeNftReleasePostureTest(unittest.TestCase):
    def test_release_check_is_offline_and_read_only(self) -> None:
        service = compose_service(rendered_compose_config(CHECK), "release-check")
        assert_offline_read_only_release_check(self, service)
        self.assertEqual("tools/bike-nft-release", compose_mapping(service, "environment")["RELEASE_TOOL_DIR"])

    def test_deployment_authority_is_split_by_phase(self) -> None:
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
                signer = services["deploy-release"]
                self.assertEqual({"release_artifact_internal": None}, services["release-artifact"]["networks"])
                signer_command = compose_command_text(signer)
                self.assertNotIn("release-plan.args", signer_command)
                plan_name = {"contracts": "CONTRACT_RELEASE_PLAN_PATH", "ui": "UI_RELEASE_PLAN_PATH", "cam": "CAM_PUBLICATION_PLAN_PATH"}[operation]
                self.assertEqual("/release-plan/release-plan.json", compose_mapping(signer, "environment")[plan_name])
                self.assertIn("PRIVATE_KEY=", signer_command)
                self.assertNotIn("export PRIVATE_KEY", signer_command)

    def test_verification_uses_retained_read_only_evidence_without_signing(self) -> None:
        for phase, role in (("CONTRACT", "contract"), ("UI", "ui"), ("CAM", "cam")):
            with self.subTest(phase=phase):
                config = rendered_compose_config(makefile_compose_unit(f"{phase}_RELEASE_ARTIFACT_COMPOSE_FILES"), env=RELEASE_ENV)
                services = compose_mapping(config, "services")
                assert_verification_has_no_signing_authority(self, services)
                collector = services["release-artifact"]
                receipt_evidence = "/approval-audit" if phase == "CAM" else "/release-broadcast"
                targets = ("/release-plan", receipt_evidence, "/reference")
                if phase == "CAM":
                    targets = (*targets, "/root-proof")
                for target in targets:
                    self.assertIs(compose_volume(collector, target)["read_only"], True)
                publisher = services[f"release-{role}-publish"]
                assert_offline_read_only_release_check(self, publisher)
                self.assertIs(compose_volume(publisher, f"/{role}-candidate")["read_only"], True)
                if phase != "CAM":
                    verifier = services[f"release-{role}-verify"]
                    self.assertIn('--sig "verify()"', compose_command_text(verifier))
                    self.assertIn("--offline", compose_command_text(verifier))
                    for target in ("/work/dapps", "/release-plan", f"/{role}-candidate"):
                        self.assertIs(compose_volume(verifier, target)["read_only"], True)
                self.assertNotIn("deployment.args", str(config))
                self.assertNotIn("DEPLOYMENT_ARGUMENTS", str(config))

    def test_make_entrypoints_require_clean_snapshotted_source_and_protected_files(self) -> None:
        for phase in ("contracts", "ui", "cam"):
            target = "publish" if phase == "cam" else "deploy"
            with self.subTest(phase=phase):
                deploy = expanded_release_target(f"bike-nft/release/{phase}/{target}")
                self.assertIn("require_release_rpc_input", deploy)
                self.assertIn('require_protected_release_file "$DEPLOYER_PRIVATE_KEY_FILE" DEPLOYER_PRIVATE_KEY_FILE "$DEPLOYER_PRIVATE_KEY_FILE"', deploy)
                self.assertIn("git archive", deploy)
                self.assertIn('"${release_phase_overlays[@]}" "${release_transport_args[@]}"', deploy)
                self.assertIn(f'release_operation="{phase}"', deploy)
                artifact = expanded_release_target(f"bike-nft/release/{phase}/artifact")
                self.assertIn("-plan-source bike-nft", artifact)
                self.assertIn('source_commit="$(< "$release_config_dir/', artifact)
                self.assertIn("env -u PRIVATE_KEY -u RPC_URL", artifact)
                self.assertNotIn('require_protected_release_file "$DEPLOYER_PRIVATE_KEY_FILE"', artifact)
        verify = expanded_release_target("bike-nft/release/verify")
        self.assertIn("release_full bike-nft verify", verify)
        self.assertIn('release_run_owned "$release_make_cleanup_grace" make', verify)


if __name__ == "__main__":
    unittest.main()
