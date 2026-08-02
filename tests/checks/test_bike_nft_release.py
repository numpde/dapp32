from __future__ import annotations

import unittest

from .common import (
    compose_command_text,
    compose_mapping,
    compose_sequence_or_empty,
    compose_service,
    compose_volume,
    read_text,
    rendered_compose_config,
    repo_path,
)


CHECK = "compose/bike-nft/release/check.yml"
DEPLOY = "compose/bike-nft/release/deploy.yml"
VERIFY = "compose/bike-nft/release/verify.yml"


class BikeNftReleasePostureTest(unittest.TestCase):
    def test_release_check_is_offline_and_read_only(self) -> None:
        service = compose_service(rendered_compose_config(CHECK), "bike-nft-release-check")
        self.assertEqual("none", service["network_mode"])
        self.assertIs(service["read_only"], True)
        self.assertIn("ALL", compose_sequence_or_empty(service, "cap_drop"))
        self.assertIn("tools/bike-nft-release/tsconfig.json", compose_command_text(service))

    def test_deployment_authority_is_split_by_phase(self) -> None:
        config = rendered_compose_config(DEPLOY)
        plan = compose_service(config, "bike-nft-release-plan")
        signer = compose_service(config, "deploy-bike-nft-release")
        artifact = compose_service(config, "bike-nft-release-artifact")
        send_proxy = compose_service(config, "bike-nft-release-rpc-proxy")
        read_proxy = compose_service(config, "bike-nft-release-artifact-rpc-proxy")

        self.assertEqual("none", plan["network_mode"])
        self.assertEqual({"bike_nft_release_deploy_internal": None}, signer["networks"])
        self.assertEqual({"bike_nft_release_artifact_internal": None}, artifact["networks"])
        self.assertIn("eth_sendRawTransaction", compose_mapping(send_proxy, "environment")["RPC_ALLOWED_METHODS"])
        self.assertNotIn("eth_sendRawTransaction", compose_mapping(read_proxy, "environment")["RPC_ALLOWED_METHODS"])
        self.assertEqual(
            [{"source": "deployer_private_key", "target": "deployer_private_key"}],
            compose_sequence_or_empty(signer, "secrets"),
        )
        self.assertNotIn("PRIVATE_KEY", compose_mapping(signer, "environment"))

        self.assertIsNot(compose_volume(plan, "/release-plan").get("read_only"), True)
        self.assertIs(compose_volume(signer, "/release-plan")["read_only"], True)
        self.assertIsNot(compose_volume(signer, "/release-broadcast").get("read_only"), True)
        self.assertIs(compose_volume(artifact, "/release-plan")["read_only"], True)
        self.assertIs(compose_volume(artifact, "/release-broadcast")["read_only"], True)
        self.assertIsNot(compose_volume(artifact, "/release-artifact").get("read_only"), True)

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
        proxy = compose_service(config, "bike-nft-release-verify-rpc-proxy")

        self.assertEqual("none", input_check["network_mode"])
        self.assertEqual("service_completed_successfully", provenance["depends_on"]["bike-nft-release-verify-input"]["condition"])
        self.assertEqual("service_completed_successfully", verifier["depends_on"]["bike-nft-release-verify-provenance"]["condition"])
        self.assertNotIn("eth_sendRawTransaction", compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"])
        self.assertNotIn("--broadcast", compose_command_text(verifier))
        for service in (input_check, provenance, verifier):
            self.assertEqual([], [secret for secret in compose_sequence_or_empty(service, "secrets") if secret.get("target") == "deployer_private_key"])

        external_artifact = compose_volume(input_check, "/deployment/deployment.json")
        self.assertEqual("bind", external_artifact["type"])
        self.assertIn(external_artifact["bind"], ({}, {"create_host_path": False}))
        for service in (provenance, verifier):
            self.assertEqual([], [volume for volume in compose_sequence_or_empty(service, "volumes") if volume.get("type") == "bind" and volume.get("target") == "/deployment/deployment.json"])

        verified_input = compose_volume(input_check, "/out")
        verified_provenance = compose_volume(provenance, "/out")
        verified_verifier = compose_volume(verifier, "/out")
        self.assertEqual("bike_nft_release_verified", verified_input["source"])
        self.assertIsNot(verified_input.get("read_only"), True)
        self.assertEqual({}, verified_input["volume"])
        for volume in (verified_provenance, verified_verifier):
            self.assertEqual(verified_input["source"], volume["source"])
            self.assertIs(volume["read_only"], True)
            self.assertEqual({"nocopy": True}, volume["volume"])

        rendered = str(config)
        self.assertNotIn("deployment.args", rendered)
        self.assertNotIn("DEPLOYMENT_ARGUMENTS", rendered)

    def test_make_entrypoints_require_clean_source_and_protected_files(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy = source[source.index("bike-nft-release-deploy:"):source.index("bike-nft-release-verify:")]
        verify = source[source.index("bike-nft-release-verify:"):]
        self.assertIn("CONFIRM_BIKE_NFT_RELEASE_DEPLOY", deploy)
        self.assertIn("git status --porcelain --untracked-files=all", deploy)
        self.assertIn("must be outside the repository", deploy)
        self.assertIn("must not be group- or world-accessible", deploy)
        self.assertIn("git status --porcelain --untracked-files=all", verify)
        self.assertIn("RPC_URL_FILE must not be group- or world-accessible", verify)


if __name__ == "__main__":
    unittest.main()
