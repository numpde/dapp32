from __future__ import annotations

import tomllib
import unittest
from .text.test_rendered_compose_posture import makefile_compose_unit, release_deployment_units

from .common import (
    compose_command_text,
    compose_mapping,
    compose_service,
    compose_sequence_or_empty,
    compose_volume,
    read_text,
    rendered_compose_config,
    repo_path,
)
from .release_posture import (
    expanded_release_target,
    assert_deployment_authority_split,
    assert_offline_read_only_release_check,
    assert_release_output_directions,
    assert_verification_has_no_signing_authority,
)


CHECK = ("compose/release/check.yml", "compose/escrow/release/check.yml")
DEPLOY = release_deployment_units()[2]
OUTPUT_DIR = "/tmp/escrow-release-output"
RPC_URL_FILE = "/tmp/escrow-release-rpc-url"
PRIVATE_KEY_FILE = "/tmp/escrow-release-private-key"
SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"
RELEASE_ENV = {
    "CONTRACT_RELEASE_APP": "escrow", "UI_RELEASE_APP": "escrow", "CAM_RELEASE_APP": "escrow",
    "RELEASE_APPROVAL_APP": "escrow",
    "CONTRACT_RELEASE_SOURCE_COMMIT": SOURCE_COMMIT,
    "UI_RELEASE_SOURCE_COMMIT": SOURCE_COMMIT,
    "CAM_RELEASE_SOURCE_COMMIT": SOURCE_COMMIT,
    "DEPLOYER_PRIVATE_KEY_FILE": PRIVATE_KEY_FILE,
    "RPC_URL_FILE": RPC_URL_FILE,
    "RELEASE_OUTPUT_DIR": OUTPUT_DIR,
    "RELEASE_APPROVAL_ARTIFACTS_DIR": f"{OUTPUT_DIR}/approval-artifacts",
    "RELEASE_APPROVAL_REFERENCE_DIR": f"{OUTPUT_DIR}/approval-reference",
    "RELEASE_APPROVAL_REFERENCE_FILE": f"{OUTPUT_DIR}/approval-reference/reference.json",
    "RELEASE_APPROVAL_AUDIT_DIR": f"{OUTPUT_DIR}/approval-audit",
}


class EscrowReleasePostureTest(unittest.TestCase):
    def test_base_signer_has_no_ungated_rpc_path(self) -> None:
        config = rendered_compose_config(makefile_compose_unit("CONTRACT_RELEASE_DEPLOY_COMPOSE_FILES"), env=RELEASE_ENV)
        services = compose_mapping(config, "services")
        signer = services["deploy-release"]
        self.assertNotIn("release-approval", services)
        self.assertEqual("none", signer["network_mode"])
        self.assertNotIn("networks", signer)
        self.assertIn("--rpc-url file:///run/approval/rpc.sock", compose_command_text(signer))
        self.assertNotIn("/run/approval", [volume["target"] for volume in signer["volumes"]])

    def test_release_check_is_offline_and_read_only(self) -> None:
        config = rendered_compose_config(CHECK, env=RELEASE_ENV)
        service = compose_service(config, "release-check")

        assert_offline_read_only_release_check(self, service)
        self.assertEqual("tools/escrow-release", compose_mapping(service, "environment")["RELEASE_TOOL_DIR"])
        self.assertIn("/*.test.ts", compose_command_text(service))

    def test_release_make_targets_fail_closed(self) -> None:
        for phase in ("contracts", "ui", "cam"):
            with self.subTest(phase=phase):
                action = "publish" if phase == "cam" else "deploy"
                deploy = expanded_release_target(f"escrow/release/{phase}/{action}")
                self.assertIn("DEPLOYER_PRIVATE_KEY_FILE", deploy)
                self.assertIn("require_release_rpc_input", deploy)
                self.assertIn('require_protected_release_file "$DEPLOYER_PRIVATE_KEY_FILE" DEPLOYER_PRIVATE_KEY_FILE "$DEPLOYER_PRIVATE_KEY_FILE"', deploy)
                prefix = {"contracts": "CONTRACT", "ui": "UI", "cam": "CAM"}[phase]
                self.assertIn(f'validate_new_release_output "$output_dir" {prefix}_RELEASE_OUTPUT_DIR', deploy)
                self.assertIn("env -u PRIVATE_KEY -u RPC_URL", deploy)
                self.assertNotIn('rm -rf "$output_dir"', deploy)
                artifact = expanded_release_target(f"escrow/release/{phase}/artifact")
                self.assertIn("read-only RPC access; no signing key is used", artifact)
                self.assertIn('require_release_file "$release_config_input"', artifact)
                self.assertIn("-plan-source escrow", artifact)
                self.assertIn("env -u PRIVATE_KEY -u RPC_URL", artifact)
                self.assertNotIn('require_protected_release_file "$DEPLOYER_PRIVATE_KEY_FILE"', artifact)

    def test_release_make_targets_run_from_disposable_commit_snapshots(self) -> None:
        source = read_text(repo_path("Makefile"))
        deploy = expanded_release_target("escrow/release/contracts/deploy")
        verify = expanded_release_target("escrow/release/contracts/artifact")
        cleanup = source[source.index("define release_snapshot_cleanup"):source.index("endef", source.index("define release_snapshot_cleanup"))]

        self.assertIn('GIT_NO_REPLACE_OBJECTS=1 git archive', source)
        self.assertIn('"$$release_run_started" == "1" ]] && ! compose_release down', cleanup)
        self.assertIn('"$$release_check_started" == "1" ]] && ! compose_release_check down', cleanup)
        self.assertIn('"$$release_dependencies_started" == "1" ]] && ! compose_release_dependencies down', cleanup)
        self.assertIn('"$$cleanup_failed" == "0" ]] && ! rm -rf', cleanup)
        # Incomplete cleanup overrides even an existing failure/signal with 2,
        # so the enclosing owner retains mounted inputs. Lifecycle tests cover
        # the actual exit status and retained files for each failure path.
        self.assertIn('if [[ "$$cleanup_failed" != "0" ]]; then', cleanup)
        failed_cleanup = cleanup.split('if [[ "$$cleanup_failed" != "0" ]]; then', 1)[1]
        self.assertIn('status=2;', failed_cleanup)
        self.assertIn('Release cleanup is incomplete; retained path for inspection:', failed_cleanup)
        self.assertIn('exit "$$status"', failed_cleanup)
        for phase in ("run", "check", "deps"):
            self.assertIn(f'COMPOSE_PROJECT_NAME="$$ceremony_project-{phase}"', source)

        self.assertIn("release_phase=deploy;", deploy)
        self.assertIn('source_commit="$(< "$release_config_dir/contract-source")"', verify)
        self.assertIn('-f "$ceremony_source/compose/release/contracts.yml"', deploy)
        self.assertIn('"${release_phase_overlays[@]}" "${release_transport_args[@]}"', deploy)
        self.assertIn('-f compose/release/contracts-artifact.yml "${release_transport_args[@]}"', verify)
        prepare = source.split("define release_prepare_snapshot\n", 1)[1].split("\nendef", 1)[0]
        execute = source.split("define release_deploy_execution\n", 1)[1].split("\nendef", 1)[0]
        self.assertLess(prepare.index("trap cleanup EXIT"), prepare.index("$(release_snapshot_allocate)"))
        self.assertLess(prepare.index("$(release_snapshot_allocate)"), prepare.index("$(release_snapshot_populate)"))
        self.assertLess(prepare.index("$(release_snapshot_populate)"), prepare.index("compose_release_dependencies run"))
        self.assertLess(execute.index("$(release_prepare_snapshot)"), execute.index("compose_release_check run"))
        self.assertLess(execute.index("compose_release_check run"), execute.index('mkdir --mode=0700 -- "$$output_dir"'))
        self.assertLess(execute.index('mkdir --mode=0700 -- "$$output_dir"'), execute.index("release_approval_prepare"))
        self.assertLess(execute.index("release_approval_prepare"), execute.index("release_approval_run"))
        self.assertIn('"$$output_dir/plan" "$$output_dir/broadcast" "$$output_dir/artifact"', execute)
        self.assertIn('-f "$$ceremony_source/$(file)"', source)

    def test_deployment_signer_is_secret_file_backed_and_proxy_scoped(self) -> None:
        config = rendered_compose_config(DEPLOY, env=RELEASE_ENV)
        plan = compose_service(config, "release-plan")
        deploy_proxy = compose_service(config, "release-rpc-proxy")
        artifact_proxy = compose_service(config, "release-artifact-rpc-proxy")
        deploy = compose_service(config, "deploy-release")
        artifact = compose_service(config, "release-artifact")

        assert_deployment_authority_split(
            self,
            config,
            operation="contracts",
            planner_name="release-plan",
            signer_name="deploy-release",
            materializer_name="release-artifact",
            signing_proxy_name="release-rpc-proxy",
            materializer_proxy_name="release-artifact-rpc-proxy",
        )
        assert_release_output_directions(
            self,
            operation="contracts",
            publisher=compose_service(config, "release-contract-publish"),
            candidate_target="/contract-candidate",
            planner=plan,
            signer=deploy,
            materializer=artifact,
            plan_target="/release-plan",
            broadcast_target="/release-broadcast",
            artifact_target="/contract-artifact",
        )
        self.assertEqual("none", deploy["network_mode"])
        self.assertEqual({"release_artifact_internal": None}, artifact["networks"])
        self.assertEqual(
            {
                "release_deploy_egress": {},
                "release_deploy_internal": {"aliases": ["release-rpc-proxy"]},
            },
            deploy_proxy["networks"],
        )
        self.assertEqual(
            {
                "release_artifact_egress": {},
                "release_artifact_internal": {"aliases": ["release-artifact-rpc-proxy"]},
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
        evidence_targets = {"/release-plan", "/release-broadcast", "/contract-candidate", "/contract-artifact", "/run/inputs/rpc_url"}
        for service in config["services"].values():
            for mount in compose_sequence_or_empty(service, "volumes"):
                if mount["target"] not in evidence_targets:
                    continue
                options = mount.get("bind")
                if options is not None:
                    self.assertIsNot(options.get("create_host_path"), True)

        deploy_command = compose_command_text(deploy)
        self.assertNotIn("release-plan.args", deploy_command)
        self.assertIn("CONTRACT_RELEASE_PLAN_PATH", compose_mapping(deploy, "environment"))
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
        artifact_write = compose_volume(compose_service(config, "release-contract-publish"), "/contract-artifact")

        self.assertEqual(f"{OUTPUT_DIR}/plan", plan_write["source"])
        self.assertEqual(f"{OUTPUT_DIR}/broadcast", deploy_broadcast["source"])
        self.assertEqual(f"{OUTPUT_DIR}/artifact", artifact_write["source"])
        for volume in (plan_write, deploy_plan, deploy_broadcast, artifact_plan, artifact_broadcast, artifact_write):
            self.assertIn(volume["bind"], ({}, {"create_host_path": False}))

    def test_verifier_has_original_source_and_receipt_evidence_without_send_authority(self) -> None:
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
                    mount = compose_volume(collector, target)
                    self.assertIs(mount["read_only"], True)
                    self.assertIsNot(mount["bind"].get("create_host_path"), True)
                proxy = services["release-artifact-rpc-proxy"]
                methods = compose_mapping(proxy, "environment")["RPC_ALLOWED_METHODS"]
                self.assertIn("eth_getTransactionReceipt", methods)
                self.assertIn("eth_getTransactionByHash", methods)
                self.assertIn("eth_getCode", methods)
                publisher = services[f"release-{role}-publish"]
                assert_offline_read_only_release_check(self, publisher)
                self.assertIs(compose_volume(publisher, f"/{role}-candidate")["read_only"], True)
                if phase != "CAM":
                    verifier = services[f"release-{role}-verify"]
                    self.assertIn('--sig "verify()"', compose_command_text(verifier))
                    self.assertIn("--offline", compose_command_text(verifier))
                    for target in ("/work/dapps", "/release-plan", f"/{role}-candidate"):
                        self.assertIs(compose_volume(verifier, target)["read_only"], True)
                else:
                    self.assertNotIn("release-cam-verify", services)
                    self.assertIs(compose_volume(collector, "/prepared")["read_only"], True)
                self.assertNotIn("deployment.args", str(config))
                self.assertNotIn("DEPLOYMENT_ARGUMENTS", str(config))


if __name__ == "__main__":
    unittest.main()
