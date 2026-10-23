from __future__ import annotations

import unittest

from .common import compose_sequence_or_empty, import_python_module_with_env, rendered_compose_config, repo_path
from .text.test_rendered_compose_posture import makefile_compose_unit


class ReleaseWaitOracleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.probe = import_python_module_with_env("release_wait_probe", repo_path("tests/fixtures/release-rehearsal/wait_probe.py"), {})

    def trace(self):
        return [
            {"event": "send", "at": 0, "fingerprint": "original"},
            {"event": "expected_hash", "at": 0, "hash": "0x123"},
            {"event": "health", "at": 1, "elapsed": 0.1},
            {"event": "block", "at": 1, "elapsed": 0.1},
            {"event": "forward", "at": 10, "fingerprint": "original"},
            {"event": "accepted", "at": 10.1, "hash": "0x123"},
            {"event": "response", "at": 10.2, "first": True},
            {"event": "first_finished", "at": 10.2},
            {"event": "receipt_success", "at": 10.3},
        ]

    def test_success_requires_the_wait_and_a_single_identical_submission(self):
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        self.assertEqual("pass", self.probe.evaluate("delay-10", self.trace(), 0, receipt)[0])
        replacement = [*self.trace(), {"event": "send", "at": 2, "fingerprint": "replacement"}]
        early = self.trace()
        early[4]["at"] = 9
        changed_bytes = self.trace()
        changed_bytes[4]["fingerprint"] = "changed"
        for changed in [replacement, early, changed_bytes]:
            with self.subTest(trace=changed):
                self.assertEqual("compatibility_failure", self.probe.evaluate("delay-10", changed, 0, receipt)[0])

    def test_harness_failure_is_not_a_client_compatibility_measurement(self):
        for events, status in [([], 1), (self.trace(), 124), ([{"event": "harness_error", "at": 0}], 1)]:
            with self.subTest(events=events, status=status):
                self.assertEqual("inconclusive", self.probe.evaluate("delay-10", events, status, None)[0])

    def test_chain_receipt_does_not_substitute_for_client_receipt_or_responsive_reads(self):
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        missing_receipt = [row for row in self.trace() if row["event"] != "receipt_success"]
        late_read = self.trace()
        late_read[3]["at"] = 11
        contradictory_hash = self.trace()
        contradictory_hash[1]["hash"] = "0xBAD"
        for changed in [missing_receipt, late_read, contradictory_hash]:
            with self.subTest(trace=changed):
                self.assertEqual("compatibility_failure", self.probe.evaluate("delay-10", changed, 0, receipt)[0])

    def test_receipt_control_requires_mining_delay_and_no_premature_next_send(self):
        events = [
            {"event": "send", "at": 0, "fingerprint": "original"},
            {"event": "expected_hash", "at": 0, "hash": "0x123"},
            {"event": "forward", "at": 0.1, "fingerprint": "original"},
            {"event": "accepted", "at": 0.2, "hash": "0x123"},
            {"event": "response", "at": 0.3, "first": True},
            {"event": "receipt_null", "at": 1},
            {"event": "mine", "at": 11},
            {"event": "receipt_success", "at": 12},
            {"event": "send", "at": 13, "fingerprint": "next"},
        ]
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        self.assertEqual("pass", self.probe.evaluate("receipt", events, 0, receipt)[0])
        events[-1]["at"] = 5
        self.assertEqual("compatibility_failure", self.probe.evaluate("receipt", events, 0, receipt)[0])
        events[-1]["at"] = 13
        events[-2]["at"] = 2
        self.assertEqual("compatibility_failure", self.probe.evaluate("receipt", events, 0, receipt)[0])

    def test_drop_control_requires_a_failed_first_response_not_just_a_label(self):
        events = [
            {"event": "send", "at": 0, "fingerprint": "original"},
            {"event": "expected_hash", "at": 0, "hash": "0x123"},
            {"event": "forward", "at": 0.1, "fingerprint": "original"},
            {"event": "accepted", "at": 0.2, "hash": "0x123"},
            {"event": "dropped", "at": 0.3},
            {"event": "response_failed", "at": 0.4, "first": True},
            {"event": "first_finished", "at": 0.5},
        ]
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        self.assertEqual("pass", self.probe.evaluate("drop", events, 1, receipt)[0])
        events[-2]["event"] = "response"
        self.assertEqual("compatibility_failure", self.probe.evaluate("drop", events, 1, receipt)[0])

    def test_denial_control_never_counts_an_upstream_send_as_success(self):
        events = [
            {"event": "send", "at": 0, "fingerprint": "original"},
            {"event": "denied", "at": 0.1},
            {"event": "send", "at": 1, "fingerprint": "original"},
            {"event": "denied", "at": 1.1},
        ]
        self.assertEqual("pass", self.probe.evaluate("reject", events, 1, None)[0])
        events.append({"event": "forward", "at": 1.2, "fingerprint": "original"})
        self.assertEqual("compatibility_failure", self.probe.evaluate("reject", events, 1, None)[0])


class ReleaseWaitPostureTest(unittest.TestCase):
    def test_ipc_release_uses_stock_broadcast_with_only_the_proxy_networked(self):
        files = (*makefile_compose_unit("ESCROW_RELEASE_DEPLOY_COMPOSE_FILES"), "compose/release/rehearsal-deploy.yml", "compose/release/rehearsal-ipc.yml")
        services = rendered_compose_config(files)["services"]
        signer = services["deploy-release"]
        proxy = services["release-rpc-proxy"]
        self.assertEqual("none", signer["network_mode"])
        self.assertEqual([], compose_sequence_or_empty(signer, "networks"))
        self.assertIn("--broadcast --slow", signer["command"][-1])
        self.assertIn("--rpc-url file:///run/approval/rpc.sock", signer["command"][-1])
        self.assertIn("release_deploy_egress", proxy["networks"])
        for name, service in services.items():
            socket_mounts = [v for v in compose_sequence_or_empty(service, "volumes") if v["target"] == "/run/approval"]
            self.assertEqual(name in ("deploy-release", "release-rpc-proxy"), bool(socket_mounts))
            if socket_mounts:
                if name == "deploy-release":
                    self.assertIs(socket_mounts[0].get("read_only"), True)
                else:
                    self.assertIsNot(socket_mounts[0].get("read_only"), True)
                self.assertIsNot(socket_mounts[0]["bind"].get("create_host_path"), True)

    def test_http_wait_probe_uses_its_fixture_transport_and_scopes_evidence(self):
        files = (*makefile_compose_unit("ESCROW_RELEASE_DEPLOY_COMPOSE_FILES"), "compose/release/rehearsal-deploy.yml")
        baseline = rendered_compose_config(files)["services"]
        services = rendered_compose_config((*files, "compose/release/rehearsal-waits.yml"))["services"]
        base_signer = baseline["deploy-release"]
        signer = services["deploy-release"]
        self.assertEqual("none", base_signer["network_mode"])
        self.assertIn("--rpc-url file:///run/approval/rpc.sock", base_signer["command"][-1])
        self.assertNotIn("network_mode", signer)
        self.assertEqual({"release_deploy_internal": None}, signer["networks"])
        self.assertIn("--rpc-url http://release-rpc-proxy:8080", signer["command"][-1])
        self.assertNotIn("/run/approval", [volume["target"] for volume in signer["volumes"]])
        self.assertEqual(baseline["release-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"], services["release-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"])
        for name, service in services.items():
            self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            evidence = [volume for volume in compose_sequence_or_empty(service, "volumes") if volume["target"] == "/wait-evidence"]
            self.assertEqual(name == "release-rpc-proxy", bool(evidence))
            self.assertLessEqual(len(evidence), 1)
            if evidence:
                self.assertIsNot(evidence[0].get("read_only"), True)
                self.assertIsNot(evidence[0]["bind"].get("create_host_path"), True)


class IpcWaitOracleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.probe = import_python_module_with_env("release_ipc_probe", repo_path("tests/fixtures/release-rehearsal/ipc_probe.py"), {})

    def test_same_socket_result_follows_evaluated_events(self):
        evidence = {"passed": True, "read_elapsed": 0.01, "send_elapsed": 3.01}
        complete = [
            {"event": "synthetic_send_started", "at": 0, "connection": 1},
            {"event": "synthetic_send_finished", "at": 3, "connection": 1},
        ]
        self.assertEqual("pass", self.probe.evaluate("same-socket", complete, 0, None, evidence))
        self.assertEqual("compatibility_failure", self.probe.evaluate("same-socket", complete[:1], 0, None, evidence))
        self.assertEqual("compatibility_failure", self.probe.evaluate("same-socket", [*complete, {"event": "forward", "at": 2}], 0, None, evidence))

    def test_delayed_receipt_requires_later_distinct_send(self):
        events = [
            {"event": "send", "at": 0, "fingerprint": "first"},
            {"event": "expected_hash", "at": 0, "hash": "0x123"},
            {"event": "forward", "at": 0.1, "fingerprint": "first"},
            {"event": "accepted", "at": 0.2, "hash": "0x123"},
            {"event": "receipt_null", "at": 1},
            {"event": "mine", "at": 11},
            {"event": "receipt_success", "at": 12},
        ]
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        self.assertEqual("compatibility_failure", self.probe.evaluate("receipt", events, 0, receipt, None))
        events.append({"event": "send", "at": 13, "fingerprint": "next"})
        self.assertEqual("pass", self.probe.evaluate("receipt", events, 0, receipt, None))
        events[-1]["at"] = 10
        self.assertEqual("compatibility_failure", self.probe.evaluate("receipt", events, 0, receipt, None))

    def test_loss_during_hold_requires_no_chain_receipt(self):
        events = [
            {"event": "send", "at": 0, "fingerprint": "first"},
            {"event": "expected_hash", "at": 0, "hash": "0x123"},
            {"event": "dropped_during_hold", "at": 1},
        ]
        self.assertEqual("pass", self.probe.evaluate("loss-hold", events, 1, None, None))
        receipt = {"status": "0x1", "transactionHash": "0x123"}
        self.assertEqual("compatibility_failure", self.probe.evaluate("loss-hold", events, 1, receipt, None))
