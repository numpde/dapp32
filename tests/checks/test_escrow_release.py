from __future__ import annotations

import unittest

from .common import (
    compose_command_text,
    compose_mapping,
    compose_sequence_or_empty,
    compose_service,
    compose_volume,
    rendered_compose_config,
)


CHECK = "compose/escrow/release/check.yml"
DEPLOY = "compose/escrow/release/deploy.yml"
VERIFY = "compose/escrow/release/verify.yml"
OUTPUT_DIR = "/tmp/escrow-release-output"
ARTIFACT_FILE = "/tmp/escrow-release-output/deployment.json"
RPC_URL_FILE = "/tmp/escrow-release-rpc-url"
PRIVATE_KEY_FILE = "/tmp/escrow-release-private-key"
SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
RELEASE_ENV = {
    "DEPLOYER_PRIVATE_KEY_FILE": PRIVATE_KEY_FILE,
    "ESCROW_DEPLOYMENT_ARTIFACT_FILE": ARTIFACT_FILE,
    "ESCROW_RELEASE_CAM_ROOT_OWNER": "0x0000000000000000000000000000000000000011",
    "ESCROW_RELEASE_CAM_URI": "https://example.test/escrow/cam/main.json",
    "ESCROW_RELEASE_EXPECTED_CHAIN_ID": "11155111",
    "ESCROW_RELEASE_EXPECTED_SOURCE_COMMIT": SOURCE_COMMIT,
    "ESCROW_RELEASE_OUTPUT_DIR": OUTPUT_DIR,
    "ESCROW_RELEASE_SOURCE_COMMIT": SOURCE_COMMIT,
    "RPC_URL_FILE": RPC_URL_FILE,
}


class EscrowReleasePostureTest(unittest.TestCase):
    def test_release_check_is_offline_and_read_only(self) -> None:
        config = rendered_compose_config(CHECK, env=RELEASE_ENV)
        service = compose_service(config, "escrow-release-check")

        self.assertEqual("none", service["network_mode"])
        self.assertIs(service["read_only"], True)
        self.assertIn("ALL", compose_sequence_or_empty(service, "cap_drop"))
        self.assertIn("tools/escrow-release/tsconfig.json", compose_command_text(service))
        self.assertIn("tools/escrow-release/*.test.ts", compose_command_text(service))

    def test_deployment_signer_is_secret_file_backed_and_proxy_scoped(self) -> None:
        config = rendered_compose_config(DEPLOY, env=RELEASE_ENV)
        plan = compose_service(config, "escrow-release-plan")
        proxy = compose_service(config, "escrow-release-rpc-proxy")
        deploy = compose_service(config, "deploy-escrow-release")
        artifact = compose_service(config, "escrow-release-artifact")

        self.assertEqual("none", plan["network_mode"])
        self.assertEqual({"escrow_release_internal": None}, deploy["networks"])
        self.assertEqual({"escrow_release_internal": None}, artifact["networks"])
        self.assertEqual(
            {"escrow_release_egress": None, "escrow_release_internal": {"aliases": ["escrow-release-rpc-proxy"]}},
            proxy["networks"],
        )
        self.assertNotIn("PRIVATE_KEY", compose_mapping(deploy, "environment"))
        self.assertEqual(
            [{"source": "deployer_private_key", "target": "deployer_private_key"}],
            compose_sequence_or_empty(deploy, "secrets"),
        )
        self.assertIn("eth_sendRawTransaction", compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"])

        for service in (plan, deploy, artifact):
            output = compose_volume(service, "/release-output")
            self.assertEqual(OUTPUT_DIR, output["source"])
            self.assertIsNot(output.get("read_only"), True)

    def test_verifier_has_no_signing_or_send_authority(self) -> None:
        config = rendered_compose_config(VERIFY, env=RELEASE_ENV)
        proxy = compose_service(config, "escrow-release-verify-rpc-proxy")
        verify = compose_service(config, "verify-escrow-release")

        self.assertNotIn("eth_sendRawTransaction", compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"])
        self.assertNotIn("PRIVATE_KEY", compose_mapping(verify, "environment"))
        self.assertEqual([], [
            secret
            for secret in compose_sequence_or_empty(verify, "secrets")
            if secret.get("target") == "deployer_private_key"
        ])
        artifact = compose_volume(verify, "/deployment/deployment.json")
        self.assertEqual(ARTIFACT_FILE, artifact["source"])
        self.assertIs(artifact["read_only"], True)
        self.assertNotIn("--broadcast", compose_command_text(verify))


if __name__ == "__main__":
    unittest.main()
