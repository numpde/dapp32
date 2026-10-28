import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from functools import partial
import time

from tools.release_source import publish_contract as submit_contract

publish_contract = partial(submit_contract, pause=lambda _: None, clock=time.monotonic)


JOB = "12345678-1234-1234-1234-123456789012"
CONTRACT = {"chainId": 43113, "identity": {"address": "0x" + "12" * 20}, "metadata": {"compiler": "original"}, "body": {"compilerVersion": "original"}}


def result(**changes):
    contract = {"chainId": "43113", "address": CONTRACT["identity"]["address"], "creationMatch": "exact_match", "runtimeMatch": "match"}
    contract.update(changes)
    return {"verificationId": JOB, "isJobCompleted": True, "contract": contract}


class SourcePublicationTest(unittest.TestCase):
    def test_already_verified_requires_original_metadata_and_both_exact_matches(self):
        for metadata, accepted in ((CONTRACT["metadata"], True), ({"compiler": "other"}, False)):
            with self.subTest(metadata=metadata), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / "manager.json"
                def request(method, path, body=None):
                    if method == "POST":
                        raise urllib.error.HTTPError("https://sourcify.dev/server", 409, "already verified", {}, None)
                    self.assertIn("fields=metadata", path)
                    return {**result(runtimeMatch="exact_match")["contract"], "metadata": metadata}
                if accepted:
                    self.assertEqual(metadata, publish_contract(CONTRACT, state, request=request)["metadata"])
                else:
                    with self.assertRaisesRegex(ValueError, "original compiler metadata"):
                        publish_contract(CONTRACT, state, request=request)
                self.assertEqual(accepted, json.loads(state.read_text())["attempts"][0].get("verified") is True)

    def test_success_preserves_match_levels_and_reuses_exact_request_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "manager.json"
            calls = []
            def request(method, path, body=None):
                calls.append((method, path, body))
                return {"verificationId": JOB} if method == "POST" else result()
            observed = publish_contract(CONTRACT, state, request=request)
            self.assertEqual("match", observed["runtimeMatch"])
            self.assertEqual(CONTRACT["body"], calls[0][2])
            self.assertEqual(["POST", "GET"], [call[0] for call in calls])
            self.assertEqual(observed, publish_contract(CONTRACT, state, request=lambda *_: self.fail("repeated submission")))
            with self.assertRaisesRegex(ValueError, "request changed"):
                publish_contract({**CONTRACT, "body": {}}, state, request=request)

    def test_pending_job_survives_interruption_and_next_command_only_polls(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "manager.json"
            def interrupted(method, path, body=None):
                if method == "POST":
                    return {"verificationId": JOB}
                raise TimeoutError("connection interrupted")
            with self.assertRaises(TimeoutError):
                publish_contract(CONTRACT, state, request=interrupted)
            calls = []
            def resumed(method, path, body=None):
                calls.append(method)
                return result()
            publish_contract(CONTRACT, state, request=resumed)
            self.assertEqual(["GET"], calls)
            self.assertEqual(1, len(json.loads(state.read_text())["attempts"]))

    def test_failure_keeps_evidence_and_next_command_can_submit_a_new_attempt(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "manager.json"
            def failed(method, path, body=None):
                return {"verificationId": JOB} if method == "POST" else {**result(runtimeMatch=None), "error": {"message": "mismatch"}}
            with self.assertRaisesRegex(ValueError, "did not match"):
                publish_contract(CONTRACT, state, request=failed)
            publish_contract(CONTRACT, state, request=lambda method, *_: {"verificationId": JOB} if method == "POST" else result())
            attempts = json.loads(state.read_text())["attempts"]
            self.assertEqual(2, len(attempts))
            self.assertIn("error", attempts[0]["result"])
            self.assertTrue(attempts[1]["verified"])

    def test_other_identity_or_unmatched_creation_never_counts_as_verified(self):
        for changes in ({"chainId": "1"}, {"address": "0x" + "34" * 20}, {"creationMatch": None}):
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / "manager.json"
                with self.assertRaises(ValueError):
                    publish_contract(CONTRACT, state, request=lambda method, *_: {"verificationId": JOB} if method == "POST" else result(**changes))
                self.assertNotIn("verified", json.loads(state.read_text())["attempts"][0])

    def test_wait_is_bounded_and_retains_job(self):
        with tempfile.TemporaryDirectory() as directory:
            ticks = iter((0, 1, 301))
            state = Path(directory) / "manager.json"
            def pending(method, *_):
                return {"verificationId": JOB} if method == "POST" else {**result(), "isJobCompleted": False}
            with self.assertRaisesRegex(ValueError, "same job"):
                publish_contract(CONTRACT, state, request=pending, pause=lambda _: None, clock=lambda: next(ticks))
            self.assertEqual(JOB, json.loads(state.read_text())["attempts"][0]["verificationId"])
