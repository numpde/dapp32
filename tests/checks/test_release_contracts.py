from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_sequence_or_empty, rendered_compose_config
from .release_posture import expanded_release_target


class ContractReleaseTest(unittest.TestCase):
    def test_keyless_source_verifier_is_offline_and_final_writes_belong_only_to_publisher(self):
        config = rendered_compose_config(("compose/release/artifact.yml", "compose/release/contracts-artifact.yml"))
        services = config["services"]
        self.assertNotIn("deploy-release", services)
        self.assertNotIn("release-approval", services)
        for name in ("release-contract-verify", "release-contract-publish"):
            self.assertEqual("none", services[name]["network_mode"])
        for name in ("release-artifact", "release-contract-verify", "release-contract-publish"):
            service = services[name]
            self.assertFalse(compose_sequence_or_empty(service, "secrets"))
            self.assertNotIn("PRIVATE_KEY", service["environment"])
            writes = {volume["target"] for volume in compose_sequence_or_empty(service, "volumes")
                      if volume["type"] == "bind" and not volume.get("read_only", False)}
            self.assertEqual({"/contract-candidate"} if name == "release-artifact" else
                             {"/contract-artifact"} if name == "release-contract-publish" else set(), writes)
        methods = services["release-artifact-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"].split()
        self.assertNotIn("eth_sendRawTransaction", methods)
        self.assertNotIn("eth_getStorageAt", methods)

    def test_business_planning_is_offline_and_contains_no_backing_root_or_ui_input(self):
        config = rendered_compose_config(("compose/release/deploy.yml", "compose/release/artifact.yml",
                                          "compose/release/contracts-artifact.yml", "compose/release/contracts.yml"))
        plan = config["services"]["release-plan"]
        self.assertEqual("none", plan["network_mode"])
        self.assertFalse(plan.get("depends_on"))
        self.assertFalse(compose_sequence_or_empty(plan, "secrets"))
        self.assertEqual("tools/contract-release", plan["environment"]["RELEASE_TOOL_DIR"])

    def test_business_source_failure_prevents_publication_and_names_its_keyless_recovery(self):
        script = r'''
source tools/release_approval_deploy.sh
compose_release() {
  local service="${@: -1}"
  printf '%s\n' "$service" >> "$TRACE"
  if [[ "$service" == release-contract-verify ]]; then return 1; fi
}
release_materialize_contracts "$RECORDS"
'''
        with tempfile.TemporaryDirectory() as temporary:
            records = Path(temporary)
            trace = records / "trace"
            result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c", script], cwd=ROOT,
                                    env={**os.environ, "RECORDS": str(records), "TRACE": str(trace),
                                         "CONFIG": "/private/read-only.json", "CONTRACT_RELEASE_APP": "escrow"},
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(1, result.returncode)
            self.assertNotIn("release-contract-publish", trace.read_text().splitlines())
            self.assertIn("Business verification did not complete", result.stderr)
            self.assertIn("escrow/release/contracts/artifact", result.stderr)
            self.assertNotIn("/release/contracts/deploy", result.stderr)

    def test_ordinary_business_commands_are_valid_bash_for_each_app(self):
        for app in ("bike-nft", "escrow", "pay-to-play"):
            for operation in ("deploy", "artifact"):
                with self.subTest(app=app, operation=operation):
                    result = subprocess.run(["bash", "-n"], input=expanded_release_target(f"{app}/release/contracts/{operation}"),
                                            capture_output=True, text=True)
                    self.assertEqual(0, result.returncode, result.stderr)
