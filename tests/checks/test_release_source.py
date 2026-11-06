import json
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch
from functools import partial
import time
import hashlib
import os
import subprocess

from tools import release_source
from tools.release_source import publish_contract as submit_contract, public_source_status, choose_contracts, read_publication_state, source_request_hash
from .common import ROOT

JOB = "12345678-1234-1234-1234-123456789012"
CONTRACT = {"chainId": 43113, "identity": {"address": "0x" + "12" * 20}, "metadata": {"compiler": "original"}, "body": {"compilerVersion": "original"}}
publish_contract = partial(submit_contract, compiler_metadata=CONTRACT["metadata"], pause=lambda _: None, clock=time.monotonic)


def result(**changes):
    contract = {"chainId": "43113", "address": CONTRACT["identity"]["address"], "creationMatch": "exact_match", "runtimeMatch": "match"}
    contract.update(changes)
    return {"verificationId": JOB, "isJobCompleted": True, "contract": contract}


def run_prepared_publication(directory, prepared, original, request):
    root = Path(directory)
    requests = root / "requests"
    requests.mkdir()
    entry = {**prepared, "role": "example", "location": {"contract": "Example"}, "sourceCommit": "a" * 40}
    (requests / "contracts.json").write_text(json.dumps([entry]))
    (requests / "example.json").write_text(json.dumps(entry))
    (requests / "example.metadata.json").write_text(json.dumps(original))
    paths = {"/requests": requests, "/state": root}
    stderr = StringIO()
    with patch.object(release_source, "Path", side_effect=paths.__getitem__), \
            patch.object(release_source, "request_json", request), \
            patch("sys.argv", ["release_source.py"]), redirect_stdout(StringIO()), redirect_stderr(stderr):
        return release_source.main(), stderr.getvalue()


class SourcePublicationTest(unittest.TestCase):
    def test_manual_and_automatic_origins_resume_the_same_wire_request_job(self):
        with tempfile.TemporaryDirectory() as directory:
            legacy = {**CONTRACT, "role": "camRoot", "sourceCommit": "a" * 40}
            modern = {**legacy, "identity": {**legacy["identity"], "creationInputHash": "0x" + "12" * 32}, "sourceCommit": "b" * 40}
            self.assertEqual(source_request_hash(legacy), source_request_hash(modern))
            old = Path(directory) / "old.json"
            old_state = {"requestSha256": hashlib.sha256(json.dumps(legacy, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "attempts": [{"verificationId": JOB}]}
            old.write_text(json.dumps(old_state))
            admitted = read_publication_state(legacy, old)
            target = Path(directory) / "shared.json"
            target.write_text(json.dumps(admitted))
            calls = []
            def poll(method, path, body=None):
                calls.append(method)
                return result()
            publish_contract(modern, target, request=poll)
            self.assertEqual(["GET"], calls)
            self.assertEqual(JOB, json.loads(target.read_text())["attempts"][0]["verificationId"])
            self.assertEqual(old_state, json.loads(old.read_text()))
            with self.assertRaisesRegex(ValueError, "request changed"):
                read_publication_state({**legacy, "body": {}}, old)

    def test_public_host_copies_obey_guard_rejections_for_source_and_dangling_destination(self):
        for side in ("source", "destination"):
            with self.subTest(side=side), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source = root / "request.json"
                target = root / "state.json"
                outside = root / "outside"
                if side == "source":
                    outside.write_text("private")
                    source.symlink_to(outside)
                else:
                    source.write_text("public")
                    target.symlink_to(outside)
                script = r'''
source tools/release_source_files.sh
reject_release_path_symlinks() { [[ ! -L "$1" ]]; }
copy_public_source_file "$COPY_SOURCE" "$COPY_TARGET"
'''
                result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], cwd=ROOT,
                                        env={**os.environ, "COPY_SOURCE": str(source), "COPY_TARGET": str(target)}, capture_output=True)
                self.assertNotEqual(0, result.returncode)
                if side == "destination":
                    self.assertFalse(outside.exists())
                else:
                    self.assertFalse(target.exists())
                    self.assertEqual("private", outside.read_text())

    def test_menu_status_distinguishes_absence_from_lookup_failure(self):
        absent = urllib.error.HTTPError("https://sourcify.dev/server", 404, "not found", {}, None)
        with self.assertRaises(urllib.error.HTTPError):
            public_source_status(CONTRACT, request=lambda *_: (_ for _ in ()).throw(urllib.error.HTTPError("https://sourcify.dev/server", 503, "unavailable", {}, None)))
        self.assertEqual("Not published", public_source_status(CONTRACT, request=lambda *_: (_ for _ in ()).throw(absent)))
        self.assertIn("Published", public_source_status(CONTRACT, request=lambda *_: result()["contract"]))

    def test_menu_lists_contract_facts_and_default_excludes_replaced_contracts(self):
        current = {**CONTRACT, "key": "current", "role": "manager", "selected": True,
                   "sourceCommit": "a" * 40, "location": {"contract": "BicycleComponentManager", "source": "bike-nft/src/BicycleComponentManager.sol"},
                   "network": {"name": "Fuji", "explorer": "https://testnet.snowtrace.io"},
                   "identity": {**CONTRACT["identity"], "creationTransaction": "0x" + "34" * 32}}
        old = {**current, "key": "old", "selected": False, "location": {"contract": "BicycleComponentManagerUI", "source": "bike-nft/src/BicycleComponentManagerUI.sol"}}
        catalog = {"hasSelectedDeployment": True, "contracts": [current, old]}
        for choice, expected in (("", ["current"]), ("01", ["current"]), ("3", ["old"]), ("2,3,2", ["current", "old"]), ("0", [])):
            with self.subTest(choice=choice):
                output = []
                calls = []
                def request(method, path):
                    calls.append(method)
                    return result()["contract"]
                selected = choose_contracts(catalog, request=request, answer=lambda _: choice, output=output.append)
                self.assertEqual(expected, selected)
                self.assertEqual(["GET", "GET"], calls)
                text = "\n".join(output)
                self.assertIn("BicycleComponentManagerUI — not in selected deployment", text)
                self.assertIn(current["identity"]["address"], text)
                self.assertIn("Network: Fuji · chain 43113", text)
                self.assertIn("Sourcify bytecode", text)
                self.assertIn("compiler metadata after selection", text)
                self.assertIn("a" * 40, text)
                self.assertIn("/tx/0x", text)
                self.assertNotIn("artifact/", text)

    def test_menu_lookup_failure_stays_unknown_and_rate_limit_stops_requests(self):
        contract = {**CONTRACT, "key": "one", "role": "ui", "selected": True, "sourceCommit": "a" * 40,
                    "location": {"contract": "UI", "source": "bike-nft/src/UI.sol"}, "identity": {**CONTRACT["identity"], "creationTransaction": JOB}}
        for code in (503, 429):
            output = []
            calls = []
            def unavailable(*_):
                calls.append("GET")
                raise urllib.error.HTTPError("https://sourcify.dev/server", code, "unavailable", {}, None)
            catalog = {"hasSelectedDeployment": True, "contracts": [contract, {**contract, "key": "two"}]}
            if code == 429:
                with self.assertRaisesRegex(ValueError, "rate-limiting"):
                    choose_contracts(catalog, request=unavailable, answer=lambda _: self.fail("must stop before publication"), output=output.append)
            else:
                self.assertEqual([], choose_contracts(catalog, request=unavailable, answer=lambda _: "0", output=output.append))
            self.assertEqual(1, len(calls))
            self.assertIn("Status unavailable", "\n".join(output))
            self.assertNotIn("Not published", "\n".join(output))

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

    def test_public_lookup_compares_solc_metadata_with_a_frozen_forge_request(self):
        # Forge's parsed artifact omits empty ABI outputs and the solc remapping context.
        frozen = {**CONTRACT, "metadata": {"settings": {"remappings": ["lib/=src/"]},
                                           "output": {"abi": [{"name": "set"}]}}}
        original = {"settings": {"remappings": [":lib/=src/"]},
                    "output": {"abi": [{"name": "set", "outputs": []}]}}
        for saved_job in (False, True):
            with self.subTest(saved_job=saved_job), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / f"{release_source.source_job_key(CONTRACT)}.json"
                if saved_job:
                    state.write_text(json.dumps({"requestSha256": source_request_hash(frozen), "attempts": [
                        {"verificationId": JOB, "result": result(), "verified": True}]}))
                methods = []
                def lookup(method, path, body=None):
                    methods.append(method)
                    if method == "POST":
                        self.assertEqual(frozen["body"], body)
                        raise urllib.error.HTTPError(path, 409, "already verified", {}, None)
                    return result(runtimeMatch="exact_match", metadata=original)["contract"]
                status, error = run_prepared_publication(directory, frozen, original, lookup)
                self.assertEqual(0, status, error)
                self.assertEqual(["GET"] if saved_job else ["POST", "GET"], methods)
                self.assertEqual(source_request_hash(frozen), json.loads(state.read_text())["requestSha256"])

    def test_public_metadata_keeps_json_types_and_abi_argument_order(self):
        original = {"settings": {"optimizer": {"enabled": True}},
                    "output": {"abi": [{"inputs": ["address", "uint256"]}]}}
        for changed in ({**original, "settings": {"optimizer": {"enabled": 1}}},
                        {**original, "output": {"abi": [{"inputs": ["uint256", "address"]}]}}):
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory:
                state = Path(directory) / f"{release_source.source_job_key(CONTRACT)}.json"
                frozen = {**CONTRACT, "metadata": changed}
                state.write_text(json.dumps({"requestSha256": source_request_hash(frozen), "attempts": [
                    {"verificationId": JOB, "result": result(), "verified": True}]}))
                status, error = run_prepared_publication(directory, frozen, original,
                                                         lambda *_: result(metadata=changed)["contract"])
                self.assertEqual(1, status)
                self.assertIn("metadata", error)

    def test_success_preserves_match_levels_and_refreshes_public_status_without_resubmission(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "manager.json"
            calls = []
            def request(method, path, body=None):
                calls.append((method, path, body))
                if path.startswith("/v2/contract/"):
                    return {**result()["contract"], "metadata": CONTRACT["metadata"]}
                return {"verificationId": JOB} if method == "POST" else result()
            observed = publish_contract(CONTRACT, state, request=request)
            self.assertEqual("match", observed["runtimeMatch"])
            self.assertEqual(CONTRACT["body"], calls[0][2])
            self.assertEqual(["POST", "GET"], [call[0] for call in calls])
            refreshed = publish_contract(CONTRACT, state, request=request)
            self.assertEqual(observed["runtimeMatch"], refreshed["runtimeMatch"])
            self.assertEqual(["POST", "GET", "GET"], [call[0] for call in calls])
            with self.assertRaisesRegex(ValueError, "request changed"):
                publish_contract({**CONTRACT, "body": {}}, state, request=request)

    def test_legacy_conflict_rechecks_without_another_post(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "root.json"
            remote = result(runtimeMatch="exact_match", metadata=CONTRACT["metadata"])["contract"]
            conflict = {"alreadyVerified": True, "result": {"isJobCompleted": True, "contract": remote}}
            state.write_text(json.dumps({"requestSha256": source_request_hash(CONTRACT), "attempts": [conflict]}))
            def lookup(method, path):
                self.assertEqual("GET", method)
                self.assertIn("/v2/contract/", path)
                return remote
            for _ in range(2):
                self.assertEqual(remote, publish_contract(CONTRACT, state, request=lookup))
            attempts = json.loads(state.read_text())["attempts"]
            self.assertEqual(1, len(attempts))
            self.assertEqual(conflict["result"], attempts[0]["result"])
            self.assertTrue(attempts[0]["verified"])

    def test_conflict_survives_interruption_before_first_public_lookup(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "root.json"
            def interrupted(method, path, body=None):
                if method == "POST":
                    raise urllib.error.HTTPError(path, 409, "already verified", {}, None)
                raise TimeoutError("no public reply")
            with self.assertRaises(TimeoutError):
                publish_contract(CONTRACT, state, request=interrupted)
            def lookup(method, path):
                self.assertEqual("GET", method)
                return result(runtimeMatch="exact_match", metadata=CONTRACT["metadata"])["contract"]
            publish_contract(CONTRACT, state, request=lookup)
            self.assertEqual(1, len(json.loads(state.read_text())["attempts"]))

    def test_recheck_retains_mismatch_evidence_and_rejects_weaker_verification(self):
        receipt = result(runtimeMatch="exact_match")
        for external in (False, True):
            for changes, cause in (({"address": "0x" + "34" * 20}, "different contract"),
                                   ({"metadata": {"compiler": "unexpected"}}, "compiler"),
                                   ({"creationMatch": "match"}, "creationMatch"),
                                   ({"runtimeMatch": None}, "runtimeMatch")):
                with self.subTest(external=external, changes=changes), tempfile.TemporaryDirectory() as directory:
                    state = Path(directory) / "saved.json"
                    attempt = {"verified": True, "result": receipt,
                               **({"alreadyVerified": True} if external else {"verificationId": JOB})}
                    state.write_text(json.dumps({"requestSha256": source_request_hash(CONTRACT), "attempts": [attempt]}))
                    remote = {**receipt["contract"], "metadata": CONTRACT["metadata"], **changes}
                    def lookup(method, path):
                        self.assertEqual("GET", method)
                        return remote
                    with self.assertRaisesRegex(ValueError, cause) as failure:
                        publish_contract(CONTRACT, state, request=lookup)
                    diagnostic = state.with_suffix(".public-check.json")
                    self.assertIn(diagnostic.name, str(failure.exception))
                    check = json.loads(diagnostic.read_text())
                    self.assertEqual(remote, check["observed"])
                    self.assertFalse(check["accepted"])
                    self.assertEqual([attempt], json.loads(state.read_text())["attempts"])

    def test_saved_job_is_resubmitted_only_after_public_lookup_reports_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "saved.json"
            attempt = {"verificationId": JOB, "verified": True, "result": result()}
            state.write_text(json.dumps({"requestSha256": source_request_hash(CONTRACT), "attempts": [attempt]}))
            def unavailable(method, path):
                self.assertEqual("GET", method)
                raise urllib.error.HTTPError(path, 503, "unavailable", {}, None)
            with self.assertRaises(urllib.error.HTTPError):
                publish_contract(CONTRACT, state, request=unavailable)
            calls = []
            def missing(method, path, body=None):
                calls.append(method)
                if path.startswith("/v2/contract/"):
                    raise urllib.error.HTTPError(path, 404, "missing", {}, None)
                return {"verificationId": JOB} if method == "POST" else result()
            publish_contract(CONTRACT, state, request=missing)
            self.assertEqual(["GET", "POST", "GET"], calls)
            self.assertEqual(attempt, json.loads(state.read_text())["attempts"][0])

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
