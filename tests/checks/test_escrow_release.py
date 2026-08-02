from __future__ import annotations

import tomllib
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


CHECK = "compose/escrow/release/check.yml"
DEPLOY = "compose/escrow/release/deploy.yml"
VERIFY = "compose/escrow/release/verify.yml"
OUTPUT_DIR = "/tmp/escrow-release-output"
ARTIFACT_FILE = "/tmp/escrow-release-output/artifact/deployment.json"
RPC_URL_FILE = "/tmp/escrow-release-rpc-url"
PRIVATE_KEY_FILE = "/tmp/escrow-release-private-key"
SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
RELEASE_ENV = {
    "DEPLOYER_PRIVATE_KEY_FILE": PRIVATE_KEY_FILE,
    "ESCROW_DEPLOYMENT_ARTIFACT_FILE": ARTIFACT_FILE,
    "ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER": "0x0000000000000000000000000000000000000011",
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

        assert_offline_read_only_release_check(self, service)
        self.assertIn("tools/escrow-release/tsconfig.json", compose_command_text(service))
        self.assertIn("tools/escrow-release/*.test.ts", compose_command_text(service))

    def test_release_make_targets_fail_closed(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy_start = source.index("escrow-release-deploy:")
        verify_start = source.index("escrow-release-verify:")
        bike_start = source.index("bike-nft-release-deploy:")
        deploy = source[deploy_start:verify_start]
        verify = source[verify_start:bike_start]

        self.assertIn("CONFIRM_ESCROW_RELEASE_DEPLOY", deploy)
        self.assertIn("DEPLOYER_PRIVATE_KEY_FILE", deploy)
        self.assertIn("RPC_URL_FILE", deploy)
        self.assertIn(
            'require_protected_release_file "$$RPC_URL_FILE" "RPC_URL_FILE" "$$RPC_URL_FILE"',
            deploy,
        )
        self.assertIn(
            'require_protected_release_file "$$DEPLOYER_PRIVATE_KEY_FILE" "DEPLOYER_PRIVATE_KEY_FILE" "$$DEPLOYER_PRIVATE_KEY_FILE"',
            deploy,
        )
        self.assertIn('validate_new_release_output "$$output_dir" "ESCROW_RELEASE_OUTPUT_DIR"', deploy)
        self.assertIn("env -u PRIVATE_KEY -u RPC_URL", deploy)
        self.assertNotIn('rm -rf "$$output_dir"', deploy)

        self.assertIn("ESCROW_DEPLOYMENT_ARTIFACT_FILE", verify)
        self.assertIn(
            'require_protected_release_file "$$RPC_URL_FILE" "RPC_URL_FILE" "RPC_URL_FILE"',
            verify,
        )
        self.assertIn(
            'require_release_file "$$ESCROW_DEPLOYMENT_ARTIFACT_FILE" "ESCROW_DEPLOYMENT_ARTIFACT_FILE"',
            verify,
        )
        self.assertIn("env -u PRIVATE_KEY -u RPC_URL", verify)

    def test_release_make_targets_run_from_disposable_commit_snapshots(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy_start = source.index("escrow-release-deploy:")
        verify_start = source.index("escrow-release-verify:")
        bike_start = source.index("bike-nft-release-deploy:")
        deploy = source[deploy_start:verify_start]
        verify = source[verify_start:bike_start]
        cleanup = source[source.index("define release_snapshot_cleanup"):source.index("endef", source.index("define release_snapshot_cleanup"))]

        self.assertIn('GIT_NO_REPLACE_OBJECTS=1 git archive', source)
        self.assertIn('"$$release_run_started" == "1" ]] && ! compose_release down', cleanup)
        self.assertIn('"$$release_check_started" == "1" ]] && ! compose_release_check down', cleanup)
        self.assertIn('"$$release_dependencies_started" == "1" ]] && ! compose_release_dependencies down', cleanup)
        self.assertIn('"$$cleanup_failed" == "0" ]] && ! rm -rf', cleanup)
        self.assertIn('if [[ "$$status" == "0" ]]; then status=1; fi', cleanup)
        for phase in ("run", "check", "deps"):
            self.assertIn(f'COMPOSE_PROJECT_NAME="$$ceremony_project-{phase}"', source)

        for target in (deploy, verify):
            self.assertLess(target.index("trap cleanup EXIT"), target.index("$(release_snapshot_allocate)"))
            self.assertLess(target.index("$(release_snapshot_allocate)"), target.index("$(release_snapshot_populate)"))
            self.assertLess(target.index("$(release_snapshot_populate)"), target.index("compose_release_dependencies run --build --rm soldeer-verify"))
            self.assertLess(target.index("compose_release_dependencies run --build --rm soldeer-verify"), target.index("up --build --abort"))
            self.assertIn('-f "$$ceremony_source/$$release_compose_file"', target)

        self.assertLess(deploy.index("compose_release_dependencies run"), deploy.index("compose_release_check run"))
        self.assertLess(deploy.index("compose_release_check run"), deploy.index('mkdir --mode=0700 -- "$$output_dir"'))
        self.assertLess(deploy.index('mkdir --mode=0700 -- "$$output_dir"'), deploy.index("up --build --abort"))
        self.assertIn('"$$output_dir/plan" "$$output_dir/broadcast" "$$output_dir/artifact"', deploy)
        self.assertIn("%s/artifact/deployment.json", deploy)

    def test_deployment_signer_is_secret_file_backed_and_proxy_scoped(self) -> None:
        config = rendered_compose_config(DEPLOY, env=RELEASE_ENV)
        plan = compose_service(config, "escrow-release-plan")
        deploy_proxy = compose_service(config, "escrow-release-rpc-proxy")
        artifact_proxy = compose_service(config, "escrow-release-artifact-rpc-proxy")
        deploy = compose_service(config, "deploy-escrow-release")
        artifact = compose_service(config, "escrow-release-artifact")

        assert_deployment_authority_split(
            self,
            compose_mapping(config, "services"),
            planner_name="escrow-release-plan",
            signer_name="deploy-escrow-release",
            materializer_name="escrow-release-artifact",
            signing_proxy_name="escrow-release-rpc-proxy",
            materializer_proxy_name="escrow-release-artifact-rpc-proxy",
        )
        assert_release_output_directions(
            self,
            planner=plan,
            signer=deploy,
            materializer=artifact,
            plan_target="/release-plan",
            broadcast_target="/release-broadcast",
            artifact_target="/release-artifact",
        )
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
        artifact_methods = compose_mapping(artifact_proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertIn("eth_blockNumber", artifact_methods)
        self.assertIn("eth_getTransactionReceipt", artifact_methods)
        self.assertEqual("1000:1000", artifact_proxy["user"])
        artifact_rpc_url = compose_volume(artifact_proxy, "/run/inputs/rpc_url")
        self.assertEqual(RPC_URL_FILE, artifact_rpc_url["source"])
        self.assertIs(artifact_rpc_url["read_only"], True)
        # Compose omits an explicit false create_host_path value when it renders
        # JSON, so the checked-in source must retain this fail-closed boundary.
        self.assertEqual(4, read_text(repo_path(DEPLOY)).count("create_host_path: false"))

        deploy_command = compose_command_text(deploy)
        self.assertNotIn("release-plan.args", deploy_command)
        self.assertIn("ESCROW_RELEASE_PLAN_PATH", compose_mapping(deploy, "environment"))
        self.assertNotIn("ESCROW_RELEASE_CAM_ROOT_TEXT", deploy_command)
        foundry_config = tomllib.loads(read_text(repo_path("dapps/foundry.toml")))
        self.assertIn(
            {"access": "read", "path": "./escrow/cam/main.json"},
            foundry_config["profile"]["default"]["fs_permissions"],
        )
        self.assertIn("PRIVATE_KEY=", deploy_command)
        self.assertNotIn("export PRIVATE_KEY", deploy_command)
        self.assertIn("umask 077", deploy_command)

        plan_write = compose_volume(plan, "/release-plan")
        deploy_plan = compose_volume(deploy, "/release-plan")
        deploy_broadcast = compose_volume(deploy, "/release-broadcast")
        artifact_plan = compose_volume(artifact, "/release-plan")
        artifact_broadcast = compose_volume(artifact, "/release-broadcast")
        artifact_write = compose_volume(artifact, "/release-artifact")

        self.assertEqual(f"{OUTPUT_DIR}/plan", plan_write["source"])
        self.assertEqual(f"{OUTPUT_DIR}/broadcast", deploy_broadcast["source"])
        self.assertEqual(f"{OUTPUT_DIR}/artifact", artifact_write["source"])
        for volume in (plan_write, deploy_plan, deploy_broadcast, artifact_plan, artifact_broadcast, artifact_write):
            self.assertIn(volume["bind"], ({}, {"create_host_path": False}))

    def test_verifier_has_offline_source_and_receipt_gates_without_send_authority(self) -> None:
        config = rendered_compose_config(VERIFY, env=RELEASE_ENV)
        input_check = compose_service(config, "escrow-release-verify-input")
        proxy = compose_service(config, "escrow-release-verify-rpc-proxy")
        provenance = compose_service(config, "escrow-release-verify-provenance")
        verify = compose_service(config, "verify-escrow-release")

        assert_receipt_gated_verification(
            self,
            input_service=input_check,
            input_service_name="escrow-release-verify-input",
            provenance_service=provenance,
            provenance_service_name="escrow-release-verify-provenance",
            verifier_service=verify,
        )
        assert_verification_snapshot_boundary(
            self,
            input_service=input_check,
            downstream_services=(provenance, verify),
            external_artifact_target="/deployment/deployment.json",
            snapshot_target="/out",
        )
        assert_verification_has_no_signing_authority(
            self,
            compose_mapping(config, "services"),
        )
        self.assertIn("tools/escrow-release/verify-input.ts", compose_command_text(input_check))
        self.assertIn("tools/escrow-release/verify-provenance.ts", compose_command_text(provenance))

        proxy_methods = compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"]
        self.assertIn("eth_getStorageAt", proxy_methods)
        self.assertIn("eth_getTransactionReceipt", proxy_methods)

        artifact_input = compose_volume(input_check, "/deployment/deployment.json")
        self.assertEqual(ARTIFACT_FILE, artifact_input["source"])
        verified_input = compose_volume(input_check, "/out")
        self.assertEqual("escrow_release_verified", verified_input["source"])

        # Compose v2.40.3, pinned in the checks image, omits
        # bind.create_host_path from rendered JSON. Pin the engine policy in
        # source while the rendered assertions above own exact sources and
        # read-only access.
        self.assertEqual(2, read_text(repo_path(VERIFY)).count("create_host_path: false"))

        self.assertNotIn("deployment.args", str(config))
        self.assertNotIn("DEPLOYMENT_ARGUMENTS", str(config))


if __name__ == "__main__":
    unittest.main()
