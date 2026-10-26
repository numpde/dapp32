from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_sequence_or_empty, rendered_compose_config
from .release_posture import expanded_release_target


class UIReleaseTest(unittest.TestCase):
    def environment(self):
        return {"UI_RELEASE_APP": "escrow", "UI_RELEASE_SOURCE_COMMIT": "a" * 40,
                "UI_RELEASE_EXPECTED_CHAIN_ID": "31338", "UI_RELEASE_CONTRACT_ARTIFACT_FILE": "/tmp/backing.json",
                "UI_RELEASE_CANDIDATE_DIR": "/tmp/ui-candidate"}

    def test_keyless_materializer_cannot_publish_before_native_verification_succeeds(self):
        script = r'''
source tools/release_approval_deploy.sh
compose_release() {
  local service="${@: -1}"
  printf '%s\n' "$service" >> "$TRACE"
  if [[ "$service" == release-ui-verify && "$FAIL_PHASE" == native ]]; then return 1; fi
  if [[ "$*" == *UI_RELEASE_PHASE=verify-block* && "$FAIL_PHASE" == block ]]; then return 1; fi
  if [[ "$service" == release-ui-publish ]]; then touch "$RECORDS/artifact/ui-deployment.json"; fi
}
release_materialize_ui "$RECORDS"
'''
        for phase in ("native", "block", "none"):
            fails = phase != "none"
            with self.subTest(failing_phase=phase), tempfile.TemporaryDirectory() as temporary:
                records = Path(temporary)
                (records / "artifact").mkdir()
                trace = records / "trace"
                env = {**os.environ, "RECORDS": str(records), "TRACE": str(trace), "FAIL_PHASE": phase,
                       "CONFIG": "/private/read-only-config.json", "UI_RELEASE_APP": "escrow"}
                result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", script], cwd=ROOT,
                                        env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(1 if fails else 0, result.returncode, result.stdout + result.stderr)
                calls = trace.read_text().splitlines()
                self.assertIn("release-ui-verify", calls)
                self.assertEqual(not fails, "release-ui-publish" in calls)
                self.assertEqual(not fails, (records / "artifact/ui-deployment.json").exists())
                if fails:
                    self.assertIn("/release/ui/artifact", result.stderr)
                    self.assertNotIn("/release/ui/deploy", result.stderr)

    def test_keyless_composition_has_no_signer_and_gives_final_writes_only_to_offline_publisher(self):
        config = rendered_compose_config(("compose/release/artifact.yml", "compose/release/ui-artifact.yml"), env=self.environment())
        services = config["services"]
        self.assertNotIn("deploy-release", services)
        self.assertNotIn("release-approval", services)
        self.assertNotIn("default", config["networks"])
        self.assertEqual("none", services["release-ui-publish"]["network_mode"])
        for name in ("release-artifact", "release-ui-verify", "release-ui-publish"):
            service = services[name]
            self.assertFalse(compose_sequence_or_empty(service, "secrets"), name)
            self.assertNotIn("PRIVATE_KEY", service["environment"])
            writes = {volume["target"] for volume in compose_sequence_or_empty(service, "volumes")
                      if volume["type"] == "bind" and volume.get("read_only") is not True}
            self.assertEqual({"/ui-candidate"} if name == "release-artifact" else
                             {"/ui-artifact"} if name == "release-ui-publish" else set(), writes)
        methods = services["release-artifact-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"].split()
        self.assertIn("eth_getBlockByNumber", methods)
        self.assertNotIn("eth_sendRawTransaction", methods)

    def test_online_planner_uses_only_read_proxy_without_a_dependency_cycle(self):
        config = rendered_compose_config(("compose/release/deploy.yml", "compose/release/artifact.yml",
                                          "compose/release/ui-artifact.yml", "compose/release/ui.yml",
                                          "compose/release/reference.yml"), env=self.environment())
        planner = config["services"]["release-plan"]
        self.assertEqual({"release_artifact_internal"}, set(planner["networks"]))
        self.assertEqual({"release-artifact-rpc-proxy"}, set(planner["depends_on"]))
        self.assertFalse(config["services"]["release-artifact-rpc-proxy"].get("depends_on"))
        self.assertFalse(compose_sequence_or_empty(planner, "secrets"))

    def test_generated_commands_for_each_app_are_valid_bash(self):
        for app in ("bike-nft", "escrow", "pay-to-play"):
            for operation in ("deploy", "artifact"):
                target = f"{app}/release/ui/{operation}"
                with self.subTest(target=target):
                    script = expanded_release_target(target)
                    result = subprocess.run(["bash", "-n"], input=script, text=True, capture_output=True)
                    self.assertEqual(0, result.returncode, result.stderr)
