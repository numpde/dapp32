from __future__ import annotations

import copy
from itertools import product
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from .common import ROOT, import_python_module_with_env


class ApprovalSuccessTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.rehearsal = import_python_module_with_env(
            "approval_success", ROOT / "tools/release_approval_pty_check.py", {},
        )

    def test_automatic_approval_refuses_operator_accounts_and_skipped_simulation(self) -> None:
        cases = (
            ("skip", "0xfe7854bc8ca79fbe9dc94dfdaf8c10e5c6decab7", "normal simulation"),
            ("normal", "0x" + "1" * 40, "public rehearsal deployer"),
        )
        for app, (simulation, deployer, message) in product(("escrow", "bike-nft", "pay-to-play"), cases):
            prefix = app.upper().replace("-", "_")
            env = {
                "RELEASE_APPROVAL_IMAGE": "sha256:" + "a" * 64,
                f"{prefix}_RELEASE_OUTPUT_DIR": "/tmp/new-release",
                f"{prefix}_RELEASE_EXPECTED_DEPLOYER_ADDRESS": deployer,
                f"{prefix}_RELEASE_SOURCE_COMMIT": "b" * 40,
                "RELEASE_REHEARSAL_DIR": "/tmp",
                "RELEASE_REHEARSAL_NETWORK": "fixture-rehearsal",
                "RELEASE_APPROVAL_SIMULATION": simulation,
            }
            with self.subTest(app=app, simulation=simulation), mock.patch.dict(os.environ, env, clear=True), mock.patch.object(
                self.rehearsal, "fixture_nonce",
            ) as nonce, mock.patch.object(self.rehearsal, "release_terminal") as terminal:
                with self.assertRaisesRegex(RuntimeError, message):
                    self.rehearsal.main(app, "success")
                nonce.assert_not_called()
                terminal.assert_not_called()

    def test_unknown_or_path_like_app_fails_before_inputs_or_docker_are_used(self) -> None:
        for app in ("", "deposit-gateway", "../escrow", "escrow/release/deploy"):
            with self.subTest(app=app), mock.patch.object(self.rehearsal, "required") as required, mock.patch.object(
                self.rehearsal, "fixture_nonce",
            ) as nonce, mock.patch.object(self.rehearsal, "release_terminal") as terminal:
                with self.assertRaisesRegex(RuntimeError, "app"):
                    self.rehearsal.main(app, "reject")
                required.assert_not_called()
                nonce.assert_not_called()
                terminal.assert_not_called()

    def test_successive_chunked_reviews_require_the_complete_summary_and_replace_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
            try:
                for number in (1, 2):
                    transaction_hash = "0x" + str(number) * 64
                    wire = (
                        f"Review transaction {number}\n  Chain ID: 31338\n"
                        f"  Sender: 0x{'a' * 40}\n  Nonce: {number - 1}\n"
                        f"  Transaction hash: {transaction_hash}\n"
                        "  Press a to approve and send, r to reject and stop. No Enter for any key.\n"
                    ).encode()
                    for offset in range(0, len(wire), 7):
                        transcript.extend(wire[offset:offset + 7])
                    self.assertEqual(number, transcript.review_number)
                    self.assertEqual(transaction_hash, transcript.review["Transaction hash"])
                    self.assertTrue(transcript.review_ready)
                    transcript.extend(f"Review transaction {number + 1}\n".encode())
                    self.assertFalse(transcript.review_ready)
                    self.assertEqual({}, transcript.review)
            finally:
                transcript.finish()

    def test_argument_overflow_summary_preserves_numbered_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            transcript = self.rehearsal.Transcript(Path(directory) / "approval-pty.log")
            try:
                transcript.extend(b"Review transaction 2\n")
                transcript.extend(b"    1 Collection name: Test\n    2 Collection symbol: TEST\n")
                transcript.extend(b"    3 Initial admin: 0x123\n    4 Delay (seconds): 3600\n")
                for hidden_count in (1, 2, 3, 4, 10):
                    transcript.extend(f"    {hidden_count} more; inspect full data\n".encode())
                    self.assertEqual({
                        1: "Collection name: Test", 2: "Collection symbol: TEST",
                        3: "Initial admin: 0x123", 4: "Delay (seconds): 3600",
                    }, transcript.review_arguments)
            finally:
                transcript.finish()

    def test_approval_audit_requires_exact_order_hashes_and_challenges(self) -> None:
        approvals = [("0x" + "a" * 64, "first"), ("0x" + "b" * 64, "second")]
        events = []
        for transaction_hash, challenge in approvals:
            events.extend([
                {"kind": "pending", "hash": transaction_hash, "challenge": challenge},
                {"kind": "approved", "hash": transaction_hash, "challenge": challenge},
                {"kind": "transmitting", "hash": transaction_hash},
                {"kind": "accepted", "hash": transaction_hash},
            ])
        events.append({"kind": "closed", "reason": "approval complete"})
        self.rehearsal.check_success_audit(events, approvals)
        corruptions = [events[:-1], events[1:], events + [events[0]]]
        for field, value in (("hash", approvals[1][0]), ("challenge", "stale"), ("kind", "uncertain")):
            changed = copy.deepcopy(events)
            changed[1][field] = value
            corruptions.append(changed)
        swapped = copy.deepcopy(events)
        swapped[2], swapped[3] = swapped[3], swapped[2]
        corruptions.append(swapped)
        changed = copy.deepcopy(events)
        changed[-1]["reason"] = "operator terminal detached"
        corruptions.append(changed)
        for corrupted in corruptions:
            with self.subTest(events=corrupted):
                with self.assertRaisesRegex(RuntimeError, "audit"):
                    self.rehearsal.check_success_audit(corrupted, approvals)

    def test_only_matching_current_reviews_are_approved_once(self) -> None:
        faults = (None, "step", "nonce", "hash", "sender", "audit", "challenge", "reference-app", "action", "argument-label")
        for app, fault in product(("escrow", "bike-nft", "pay-to-play"), faults):
            with self.subTest(app=app, fault=fault), tempfile.TemporaryDirectory() as directory:
                output = Path(directory)
                (output / "approval-reference").mkdir()
                (output / "approval-audit").mkdir()
                deployer, source, digest = "0x" + "a" * 40, "b" * 40, "0x" + "c" * 64
                reference = {
                    "app": app, "expectedChainId": 31338, "expectedDeployer": deployer,
                    "sourceCommit": source, "snapshotSha256": digest,
                    "steps": [
                        {"name": "Create", "role": "root", "action": "Deploy root", "argumentLabels": ["Initial owner"], "args": [deployer]},
                        {"name": "Configure", "role": "root", "action": "Bind interface", "argumentLabels": ["CONFIGURER_ROLE: change interface"], "args": [{"createdContract": "ui"}]},
                    ],
                }
                if fault == "reference-app":
                    reference["app"] = "another-app"
                (output / "approval-reference/reference.json").write_text(json.dumps(reference))
                transcript = self.rehearsal.Transcript(output / "approval-pty.log")
                transcript.identity_lines.append(f"  Reference SHA-256: {digest}")
                commands = []
                current = 0

                def read(_master, _process, _transcript, predicate, _deadline, explanation):
                    nonlocal current
                    if explanation.startswith("signed transaction"):
                        current += 1
                        number, nonce, sender = current, current - 1, deployer
                        transaction_hash, challenge = "0x" + str(current) * 64, f"challenge-{current}"
                        if current == 2:
                            if fault == "step":
                                number = 3
                            elif fault == "nonce":
                                nonce = 999
                            elif fault == "sender":
                                sender = "0x" + "d" * 40
                            elif fault == "hash":
                                transaction_hash = "bad-hash"
                            elif fault == "challenge":
                                challenge = "challenge-1"
                        step = reference["steps"][current - 1]
                        action, label, suffix = step["action"], step["argumentLabels"][0], ""
                        if current == 2:
                            suffix = " (ui contract)"
                            if fault == "action":
                                action = "Wrong action"
                            elif fault == "argument-label":
                                label = "Wrong label"
                        transcript.extend((
                            f"Review transaction {number}\nAction: {action}\n  Chain ID: 31338\n  Sender: {sender}\n"
                            f"  Nonce: {nonce}\n  Transaction hash: {transaction_hash}\n"
                            f"  Step: {step['name']}; contract {step['role']}\n"
                            f"    1 {label}{suffix}: https://fixture.example:443/interface\n"
                            "  Press a to approve and send, r to reject and stop. No Enter for any key.\n"
                        ).encode())
                        event = {"kind": "pending", "hash": transaction_hash, "challenge": challenge,
                                 "nonce": nonce, "chainId": 31338, "sender": sender, "referenceDigest": digest}
                        if current == 2 and fault == "audit":
                            event["hash"] = "0x" + "e" * 64
                        (output / "approval-audit/approval.jsonl").write_text(json.dumps(event) + "\n")
                    self.assertTrue(predicate(), explanation)

                def write(_master, command):
                    commands.append(command)
                    if command == b"i":
                        transcript.extend(b"Full data page 1 of 2\n")
                        self.assertFalse(transcript.inspection_seen, "inspection requires the complete page footer")
                        transcript.extend(b"a approve and send; r reject and stop; n next; p previous; i back. No Enter.\n")
                    return len(command)

                try:
                    with mock.patch.object(self.rehearsal, "read_until", side_effect=read), mock.patch.object(
                        self.rehearsal.os, "write", side_effect=write,
                    ):
                        if fault is None:
                            result = self.rehearsal.approve_transactions(0, None, transcript, output, app, deployer, source, 0)
                            self.assertEqual([("0x" + str(i) * 64, f"challenge-{i}") for i in (1, 2)], result)
                        else:
                            with self.assertRaisesRegex(RuntimeError, "review|identity"):
                                self.rehearsal.approve_transactions(0, None, transcript, output, app, deployer, source, 0)
                    expected = [b"a"]
                    if fault == "reference-app":
                        expected = []
                    elif fault is None:
                        expected.append(b"a")
                    self.assertEqual(expected, [command for command in commands if command == b"a"])
                    self.assertEqual(len(expected), commands.count(b"i"))
                finally:
                    transcript.finish()

    def test_rpc_acceptance_is_insufficient_without_successful_matching_receipts(self) -> None:
        transaction_hash = "0x" + "a" * 64
        receipt = {"transactionHash": transaction_hash, "status": "0x1", "blockNumber": "0x2"}
        invalid = [None, {}, {**receipt, "status": "0x0"},
                   {**receipt, "transactionHash": "0x" + "b" * 64},
                   {**receipt, "blockNumber": None}]
        for response in [receipt, *invalid]:
            with self.subTest(response=response), mock.patch.object(
                self.rehearsal, "docker", return_value=json.dumps(response),
            ) as docker, mock.patch.object(
                self.rehearsal, "containers", return_value={"f" * 64},
            ):
                if response == receipt:
                    self.rehearsal.check_fixture_receipts("fixture", [transaction_hash])
                else:
                    with self.assertRaisesRegex(RuntimeError, "receipt"):
                        self.rehearsal.check_fixture_receipts("fixture", [transaction_hash])
                self.assertIn("eth_getTransactionReceipt", docker.call_args.args)


if __name__ == "__main__":
    unittest.main()
