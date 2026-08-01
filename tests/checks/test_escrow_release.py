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
ARGUMENTS_FILE = f"{ARTIFACT_FILE}.args"
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
        proxy_methods = compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertIn("eth_sendRawTransaction", proxy_methods)
        self.assertIn("eth_getStorageAt", proxy_methods)

        deploy_command = compose_command_text(deploy)
        self.assertIn("release-plan.args", deploy_command)
        self.assertNotIn("vm.readFile", deploy_command)
        self.assertIn("umask 077", deploy_command)

        for service in (plan, deploy, artifact):
            output = compose_volume(service, "/release-output")
            self.assertEqual(OUTPUT_DIR, output["source"])
            self.assertIsNot(output.get("read_only"), True)

    def test_verifier_has_offline_source_gate_and_no_signing_or_send_authority(self) -> None:
        config = rendered_compose_config(VERIFY, env=RELEASE_ENV)
        input_check = compose_service(config, "escrow-release-verify-input")
        proxy = compose_service(config, "escrow-release-verify-rpc-proxy")
        verify = compose_service(config, "verify-escrow-release")

        self.assertEqual("none", input_check["network_mode"])
        self.assertIn("tools/escrow-release/verify-input.ts", compose_command_text(input_check))
        self.assertEqual(
            "service_completed_successfully",
            verify["depends_on"]["escrow-release-verify-input"]["condition"],
        )

        proxy_methods = compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertNotIn("eth_sendRawTransaction", proxy_methods)
        self.assertIn("eth_getStorageAt", proxy_methods)
        self.assertNotIn("PRIVATE_KEY", compose_mapping(verify, "environment"))
        self.assertEqual([], [
            secret
            for secret in compose_sequence_or_empty(verify, "secrets")
            if secret.get("target") == "deployer_private_key"
        ])

        artifact = compose_volume(input_check, "/deployment/deployment.json")
        arguments_input = compose_volume(input_check, "/deployment/deployment.args")
        arguments_verify = compose_volume(verify, "/deployment/deployment.args")
        self.assertEqual(ARTIFACT_FILE, artifact["source"])
        self.assertEqual(ARGUMENTS_FILE, arguments_input["source"])
        self.assertEqual(ARGUMENTS_FILE, arguments_verify["source"])
        for volume in (artifact, arguments_input, arguments_verify):
            self.assertIs(volume["read_only"], True)
            self.assertIs(volume["bind"]["create_host_path"], False)

        verify_command = compose_command_text(verify)
        self.assertIn("deployment.args", verify_command)
        self.assertNotIn("--broadcast", verify_command)
        self.assertNotIn("vm.readFile", verify_command)


if __name__ == "__main__":
    unittest.main()
