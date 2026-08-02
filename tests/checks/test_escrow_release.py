from __future__ import annotations

import tomllib
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

    def test_release_make_targets_fail_closed(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy_start = source.index("escrow-release-deploy:")
        verify_start = source.index("escrow-release-verify:")
        deploy = source[deploy_start:verify_start]
        verify = source[verify_start:]

        self.assertIn("CONFIRM_ESCROW_RELEASE_DEPLOY", deploy)
        self.assertIn("git status --porcelain --untracked-files=all", deploy)
        self.assertIn("git rev-parse --verify HEAD", deploy)
        self.assertIn("DEPLOYER_PRIVATE_KEY_FILE", deploy)
        self.assertIn("RPC_URL_FILE", deploy)
        self.assertIn("must be outside the repository", deploy)
        self.assertIn("env -u PRIVATE_KEY -u RPC_URL", deploy)
        self.assertNotIn('rm -rf "$$output_dir"', deploy)

        self.assertIn("git status --porcelain --untracked-files=all", verify)
        self.assertIn("git rev-parse --verify HEAD", verify)
        self.assertIn("ESCROW_DEPLOYMENT_ARTIFACT_FILE", verify)
        self.assertIn("env -u PRIVATE_KEY -u RPC_URL", verify)

    def test_deployment_signer_is_secret_file_backed_and_proxy_scoped(self) -> None:
        config = rendered_compose_config(DEPLOY, env=RELEASE_ENV)
        plan = compose_service(config, "escrow-release-plan")
        deploy_proxy = compose_service(config, "escrow-release-rpc-proxy")
        artifact_proxy = compose_service(config, "escrow-release-artifact-rpc-proxy")
        deploy = compose_service(config, "deploy-escrow-release")
        artifact = compose_service(config, "escrow-release-artifact")

        self.assertEqual("none", plan["network_mode"])
        self.assertEqual({"escrow_release_deploy_internal": None}, deploy["networks"])
        self.assertEqual({"escrow_release_artifact_internal": None}, artifact["networks"])
        self.assertEqual(
            {
                "escrow_release_deploy_egress": {},
                "escrow_release_deploy_internal": {"aliases": ["escrow-release-rpc-proxy"]},
            },
            deploy_proxy["networks"],
        )
        self.assertEqual(
            {
                "escrow_release_artifact_egress": {},
                "escrow_release_artifact_internal": {"aliases": ["escrow-release-artifact-rpc-proxy"]},
            },
            artifact_proxy["networks"],
        )
        self.assertNotIn("PRIVATE_KEY", compose_mapping(deploy, "environment"))
        self.assertEqual(
            [{"source": "deployer_private_key", "target": "deployer_private_key"}],
            compose_sequence_or_empty(deploy, "secrets"),
        )
        deploy_methods = compose_mapping(deploy_proxy, "environment")["RPC_ALLOWED_METHODS"]
        artifact_methods = compose_mapping(artifact_proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertIn("eth_sendRawTransaction", deploy_methods)
        self.assertNotIn("eth_sendRawTransaction", artifact_methods)
        self.assertIn("eth_blockNumber", artifact_methods)
        self.assertIn("eth_getTransactionReceipt", artifact_methods)
        self.assertEqual("1000:1000", artifact_proxy["user"])
        artifact_rpc_url = compose_volume(artifact_proxy, "/run/inputs/rpc_url")
        self.assertEqual(RPC_URL_FILE, artifact_rpc_url["source"])
        self.assertIs(artifact_rpc_url["read_only"], True)
        self.assertEqual(1, read_text(repo_path(DEPLOY)).count("create_host_path: false"))

        deploy_command = compose_command_text(deploy)
        self.assertIn("release-plan.args", deploy_command)
        self.assertIn("operator-authorized release inputs", deploy_command)
        self.assertNotIn("ESCROW_RELEASE_CAM_ROOT_TEXT", deploy_command)
        self.assertIn(
            "vm.readFileBinary(CAM_ROOT_PATH)",
            read_text(repo_path("dapps/escrow/script/DeployEscrowRelease.s.sol")),
        )
        foundry_config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        self.assertIn(
            {"access": "read", "path": "./escrow/cam/main.json"},
            foundry_config["profile"]["default"]["fs_permissions"],
        )
        self.assertIn("PRIVATE_KEY=", deploy_command)
        self.assertNotIn("export PRIVATE_KEY", deploy_command)
        self.assertIn("umask 077", deploy_command)

        for service in (plan, deploy, artifact):
            output = compose_volume(service, "/release-output")
            self.assertEqual(OUTPUT_DIR, output["source"])
            self.assertIsNot(output.get("read_only"), True)

    def test_verifier_has_offline_source_and_receipt_gates_without_send_authority(self) -> None:
        config = rendered_compose_config(VERIFY, env=RELEASE_ENV)
        input_check = compose_service(config, "escrow-release-verify-input")
        proxy = compose_service(config, "escrow-release-verify-rpc-proxy")
        provenance = compose_service(config, "escrow-release-verify-provenance")
        verify = compose_service(config, "verify-escrow-release")

        self.assertEqual("none", input_check["network_mode"])
        self.assertIn("tools/escrow-release/verify-input.ts", compose_command_text(input_check))
        self.assertEqual(
            "service_completed_successfully",
            provenance["depends_on"]["escrow-release-verify-input"]["condition"],
        )
        self.assertEqual(
            "service_completed_successfully",
            verify["depends_on"]["escrow-release-verify-provenance"]["condition"],
        )
        self.assertIn("tools/escrow-release/verify-provenance.ts", compose_command_text(provenance))

        proxy_methods = compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertNotIn("eth_sendRawTransaction", proxy_methods)
        self.assertIn("eth_getStorageAt", proxy_methods)
        self.assertIn("eth_getTransactionReceipt", proxy_methods)
        for service in (provenance, verify):
            self.assertNotIn("PRIVATE_KEY", compose_mapping(service, "environment"))
            self.assertEqual([], [
                secret
                for secret in compose_sequence_or_empty(service, "secrets")
                if secret.get("target") == "deployer_private_key"
            ])

        artifact_input = compose_volume(input_check, "/deployment/deployment.json")
        artifact_provenance = compose_volume(provenance, "/deployment/deployment.json")
        arguments_input = compose_volume(input_check, "/deployment/deployment.args")
        arguments_provenance = compose_volume(provenance, "/deployment/deployment.args")
        arguments_verify = compose_volume(verify, "/deployment/deployment.args")
        self.assertEqual(ARTIFACT_FILE, artifact_input["source"])
        self.assertEqual(ARTIFACT_FILE, artifact_provenance["source"])
        for arguments in (arguments_input, arguments_provenance, arguments_verify):
            self.assertEqual(ARGUMENTS_FILE, arguments["source"])
        for label, volume in {
            "input artifact": artifact_input,
            "provenance artifact": artifact_provenance,
            "input companion": arguments_input,
            "provenance companion": arguments_provenance,
            "verifier companion": arguments_verify,
        }.items():
            with self.subTest(mount=label):
                self.assertIs(volume["read_only"], True)

        # Compose v2.40.3, pinned in the checks image, omits
        # bind.create_host_path from rendered JSON. Pin the engine policy in
        # source while the rendered assertions above own exact sources and
        # read-only access.
        self.assertEqual(3, read_text(repo_path(VERIFY)).count("create_host_path: false"))

        verify_command = compose_command_text(verify)
        self.assertIn("exact eighteen-field deployment record", verify_command)
        self.assertNotIn("--broadcast", verify_command)
        self.assertNotIn("vm.readFile", verify_command)


if __name__ == "__main__":
    unittest.main()
