"""Submit prepared public sources to Sourcify v2; no RPC or signing credentials."""

import hashlib
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).parent))
from release_instance import read_json, write_json


API = "https://sourcify.dev/server"
MAX_RESPONSE = 1024 * 1024


def request_json(method, path, body=None):
    encoded = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API + path, data=encoded, method=method, headers={
        "Content-Type": "application/json",
        "User-Agent": "cam-source-publication/1 (+https://numpde.github.io/dapp32/)",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        content = response.read(MAX_RESPONSE + 1)
    if len(content) > MAX_RESPONSE:
        raise ValueError("Public verifier response exceeds 1 MiB; no success was recorded.")
    result = json.loads(content)
    if not isinstance(result, dict):
        raise ValueError("Public verifier returned a JSON value instead of a response object; no success was recorded.")
    return result


def verification_contract(result, contract):
    observed = result.get("contract")
    address = observed.get("address") if isinstance(observed, dict) else None
    if not isinstance(observed, dict) or observed.get("chainId") != str(contract["chainId"]) or not isinstance(address, str) or address.lower() != contract["identity"]["address"].lower():
        raise ValueError("Public verifier returned a different contract or chain; no success was recorded.")
    return observed


def publish_contract(contract, state_path, *, request, pause, clock):
    request_hash = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if state_path.exists():
        state = read_json(state_path)
        if state["requestSha256"] != request_hash:
            raise ValueError("Prepared source request changed; keep the old record and use a separate publication directory.")
    else:
        state = {"requestSha256": request_hash, "attempts": []}
    attempts = state["attempts"]
    if attempts and attempts[-1].get("verified") is True:
        return attempts[-1]["result"]["contract"]
    if not attempts or ("result" in attempts[-1] and attempts[-1]["result"]["isJobCompleted"] is True):
        try:
            ticket = request("POST", f"/v2/verify/{contract['chainId']}/{contract['identity']['address']}", contract["body"])
        # silent-defaults: allow-exception-fallback -- Sourcify 409 is a documented already-verified outcome; test_already_verified_requires_original_metadata_and_both_exact_matches proves its separate admission.
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
            # A verification by someone else must describe our original compiler metadata.
            observed = request("GET", f"/v2/contract/{contract['chainId']}/{contract['identity']['address']}?fields=metadata")
            existing = {"isJobCompleted": True, "contract": observed}
            attempts.append({"alreadyVerified": True, "result": existing})
            write_json(state_path, state)
            verification_contract(existing, contract)
            if observed.get("metadata") != contract["metadata"] or observed.get("runtimeMatch") != "exact_match" or observed.get("creationMatch") != "exact_match":
                raise ValueError("Existing public verification does not exactly match the original compiler metadata and both bytecodes. Its response was retained.")
            attempts[-1]["verified"] = True
            write_json(state_path, state)
            return observed
        identifier = ticket.get("verificationId")
        if not isinstance(identifier, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", identifier):
            raise ValueError("Public verifier did not return a verification job ID; no success was recorded.")
        attempts.append({"verificationId": identifier})
        write_json(state_path, state)
    attempt = attempts[-1]
    if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", attempt["verificationId"]):
        raise ValueError("Saved public verification job ID is invalid.")
    deadline = clock() + 300
    while clock() < deadline:
        result = request("GET", f"/v2/verify/{attempt['verificationId']}")
        if result.get("verificationId") != attempt["verificationId"] or type(result.get("isJobCompleted")) is not bool:
            raise ValueError("Public verifier returned an inconsistent job status; no success was recorded.")
        attempt["result"] = result
        write_json(state_path, state)
        if result["isJobCompleted"]:
            observed = verification_contract(result, contract)
            if result.get("error") or observed.get("runtimeMatch") not in ("match", "exact_match") or observed.get("creationMatch") not in ("match", "exact_match"):
                raise ValueError(f"Public verification did not match creation and runtime code. See {state_path.name} for the verifier's explanation.")
            attempt["verified"] = True
            write_json(state_path, state)
            return observed
        pause(3)
    raise ValueError("Public verification is still pending after five minutes. Rerun source/publish to check the same job; no deployment will be repeated.")


def main():
    requests = Path("/requests")
    contracts = json.loads((requests / "contracts.json").read_text())
    failures = 0
    for contract in contracts:
        role = contract["role"]
        prepared = read_json(requests / f"{role}.json")
        print(f"Publishing {prepared['location']['contract']} on chain {prepared['chainId']} at {prepared['identity']['address']}", flush=True)
        try:
            observed = publish_contract(prepared, Path("/state") / f"{role}.json", request=request_json, pause=time.sleep, clock=time.monotonic)
        except urllib.error.HTTPError as error:
            excerpt = error.read(2048).decode("utf-8", errors="replace")
            write_json(Path("/state") / f"{role}-http-error.json", {"status": error.code, "responseExcerpt": excerpt})
            print(f"Public source verification incomplete: HTTP {error.code}. Response excerpt: {excerpt}", file=sys.stderr, flush=True)
            failures += 1
            if error.code == 429:
                print("The verifier is rate-limiting requests. Stop here and retry later; remaining contracts were not submitted.", file=sys.stderr, flush=True)
                break
            continue
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            print(f"Public source verification incomplete: {error}", file=sys.stderr, flush=True)
            failures += 1
            continue
        labels = {"exact_match": "exact match", "match": "code matches; metadata differs"}
        print(f"Creation: {labels[observed['creationMatch']]}. Runtime: {labels[observed['runtimeMatch']]}.", flush=True)
        print(f"https://repo.sourcify.dev/{prepared['chainId']}/{prepared['identity']['address']}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
