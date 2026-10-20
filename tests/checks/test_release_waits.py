from __future__ import annotations

import unittest

from .common import compose_sequence_or_empty, import_python_module_with_env, rendered_compose_config, repo_path


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
    def test_probe_keeps_real_signer_command_and_scopes_its_evidence(self):
        files = ("compose/release/deploy.yml", "compose/escrow/release/deploy.yml", "compose/release/rehearsal-deploy.yml")
        baseline = rendered_compose_config(files)["services"]
        services = rendered_compose_config((*files, "compose/release/rehearsal-waits.yml"))["services"]
        self.assertEqual(baseline["deploy-release"], services["deploy-release"])
        self.assertEqual(baseline["release-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"], services["release-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"])
        for name, service in services.items():
            self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            evidence = [volume for volume in compose_sequence_or_empty(service, "volumes") if volume["target"] == "/wait-evidence"]
            self.assertEqual(name == "release-rpc-proxy", bool(evidence))
            self.assertLessEqual(len(evidence), 1)
            if evidence:
                self.assertIsNot(evidence[0].get("read_only"), True)
                self.assertIsNot(evidence[0]["bind"].get("create_host_path"), True)
