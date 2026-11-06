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
from release_instance import read_bounded_json, read_json, write_json


API = "https://sourcify.dev/server"
MAX_RESPONSE = 1024 * 1024
SOURCE_REQUEST_MAX_BYTES = 8 * 1024 * 1024
MATCH_LABELS = {"exact_match": "exact match", "match": "code matches; metadata differs"}


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


def source_job_key(contract):
    return f"{contract['chainId']}-{contract['identity']['address'].lower()}"


def source_request_hash(contract):
    claim = {"chainId": contract["chainId"], "address": contract["identity"]["address"].lower(),
             "body": contract["body"], "metadata": contract["metadata"]}
    return hashlib.sha256(json.dumps(claim, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def read_publication_state(contract, path):
    state = read_json(path)
    expected = source_request_hash(contract)
    if state["requestSha256"] != expected:
        # Old per-operation jobs hashed bookkeeping too. Admit them only against their retained exact request.
        old_hash = hashlib.sha256(json.dumps(contract, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        if state["requestSha256"] != old_hash:
            raise ValueError("Prepared source request changed; keep the old record and use a separate publication directory.")
        state["requestSha256"] = expected
    return state


def lookup_public_contract(contract, *, request, metadata):
    suffix = "?fields=metadata" if metadata else ""
    try:
        observed = request("GET", f"/v2/contract/{contract['chainId']}/{contract['identity']['address']}{suffix}")
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise
    return observed


def public_source_status(contract, *, request):
    observed = lookup_public_contract(contract, request=request, metadata=False)
    if observed is None:
        return "Not published"
    verification_contract({"contract": observed}, contract)
    if observed.get("runtimeMatch") not in ("match", "exact_match"):
        return "No verified runtime source"
    if observed.get("creationMatch") not in ("match", "exact_match"):
        return f"Published — runtime: {MATCH_LABELS[observed['runtimeMatch']]}; creation unverified"
    return f"Published — creation: {MATCH_LABELS[observed['creationMatch']]}; runtime: {MATCH_LABELS[observed['runtimeMatch']]}"


def choose_contracts(catalog, *, request, answer, output):
    contracts = catalog["contracts"]
    output("Checking public source verification on Sourcify…")
    statuses = []
    limited = False
    for contract in contracts:
        try:
            statuses.append(public_source_status(contract, request=request))
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            statuses.append(f"Status unavailable ({error})")
            statuses.extend("Status not checked (lookup unavailable)" for _ in contracts[len(statuses):])
            limited = isinstance(error, urllib.error.HTTPError) and error.code == 429
            break
    group = [contract["key"] for contract in contracts if contract["selected"]] if catalog["hasSelectedDeployment"] else [contract["key"] for contract in contracts]
    output("Publish contract sources")
    output("Sourcify reports bytecode matches at each address. This command checks the deployment’s original compiler metadata after selection.")
    label = "selected deployment" if catalog["hasSelectedDeployment"] else "saved records"
    output(f"  1. All contracts in {label} ({len(group)})")
    for number, (contract, status) in enumerate(zip(contracts, statuses), 2):
        membership = "selected deployment" if contract["selected"] else "not in selected deployment" if catalog["hasSelectedDeployment"] else "saved contract"
        output(f"  {number}. {contract['location']['contract']} — {membership}")
        output(f"     Address: {contract['identity']['address']}")
        network = contract.get("network")
        network_name = f"{network['name']} · " if network is not None else ""
        output(f"     Network: {network_name}chain {contract['chainId']}")
        output(f"     Sourcify bytecode: {status}")
        output(f"     Recorded source: https://github.com/numpde/dapp32/blob/{contract['sourceCommit']}/dapps/{contract['location']['source']}")
        explorer = network.get("explorer") if network is not None else None
        if explorer is not None:
            output(f"     Explorer: {explorer}/address/{contract['identity']['address']}#code")
            output(f"     Creation: {explorer}/tx/{contract['identity']['creationTransaction']}")
        else:
            output(f"     Creation transaction: {contract['identity']['creationTransaction']}")
    output("  0. Cancel")
    if limited:
        raise ValueError("Sourcify is rate-limiting requests. Retry later; no sources were submitted.")
    while True:
        choice = answer("Choose contracts (comma-separated numbers; Enter for 1): ").strip()
        if choice == "0":
            return []
        numbers = ["1"] if choice == "" else [part.strip() for part in choice.split(",")]
        if all(number.isdecimal() and 1 <= int(number) <= len(contracts) + 1 for number in numbers):
            keys = []
            for number in numbers:
                for key in group if int(number) == 1 else [contracts[int(number) - 2]["key"]]:
                    if key not in keys:
                        keys.append(key)
            return keys
        output("Enter listed contract numbers, or 0 to cancel.")


def same_metadata(observed, original):
    # JSON booleans and numbers must stay distinct. Only object key order is immaterial.
    return json.dumps(observed, sort_keys=True, allow_nan=False) == json.dumps(original, sort_keys=True, allow_nan=False)


def recheck_publication(contract, compiler_metadata, state, state_path, request):
    attempt = state["attempts"][-1]
    observed = lookup_public_contract(contract, request=request, metadata=True)
    diagnostic = state_path.with_suffix(".public-check.json")
    check = {"requestSha256": state["requestSha256"], "observed": observed, "accepted": False}
    if observed is None:
        write_json(diagnostic, check)
        return None
    try:
        verification_contract({"contract": observed}, contract)
        metadata = observed.get("metadata")
        if not isinstance(metadata, dict):
            raise ValueError("Sourcify returned no compiler metadata object")
        if not same_metadata(metadata, compiler_metadata):
            fields = sorted(metadata.keys() | compiler_metadata.keys())
            difference = next(field for field in fields if field not in metadata or field not in compiler_metadata
                              or not same_metadata(metadata[field], compiler_metadata[field]))
            raise ValueError(f"Sourcify differs from the original compiler metadata in {difference!r}")

        # A conflict refers to a verification outside this request. A submitted job has its own receipt.
        external = attempt.get("alreadyVerified") is True
        saved = None if external else verification_contract(attempt["result"], contract)
        for field in ("creationMatch", "runtimeMatch"):
            required = "exact_match" if saved is None else saved.get(field)
            current = observed.get(field)
            if required not in ("match", "exact_match") or current not in (required, "exact_match"):
                raise ValueError(f"Sourcify returned {field}={current!r}. This publication requires {required!r} or better")
    except ValueError as error:
        write_json(diagnostic, {**check, "error": str(error), "expectedMetadata": compiler_metadata})
        raise ValueError(f"{error}. See {diagnostic.name}.") from error

    write_json(diagnostic, {**check, "accepted": True})
    if attempt.get("verified") is not True:
        attempt["verified"] = True
        write_json(state_path, state)
    return observed


def completed_matching_receipt(contract, attempt):
    result = attempt.get("result")
    if not isinstance(result, dict) or result.get("isJobCompleted") is not True or result.get("error"):
        return False
    try:
        observed = verification_contract(result, contract)
    except ValueError:
        return False
    return all(observed.get(field) in MATCH_LABELS for field in ("creationMatch", "runtimeMatch"))


def publish_contract(contract, state_path, *, compiler_metadata, request, pause, clock):
    if state_path.exists():
        state = read_publication_state(contract, state_path)
        write_json(state_path, state)
    else:
        state = {"requestSha256": source_request_hash(contract), "attempts": []}
    attempts = state["attempts"]
    last = attempts[-1] if attempts else {}
    if last.get("verified") is True or last.get("alreadyVerified") is True or completed_matching_receipt(contract, last):
        observed = recheck_publication(contract, compiler_metadata, state, state_path, request)
        if observed is not None:
            return observed
        raise ValueError("The completed verification is not yet in Sourcify's public index. Retry to check it; no sources were resubmitted.")
    if not attempts or (isinstance(last.get("result"), dict) and last["result"].get("isJobCompleted") is True):
        try:
            ticket = request("POST", f"/v2/verify/{contract['chainId']}/{contract['identity']['address']}", contract["body"])
        # silent-defaults: allow-exception-fallback -- Sourcify 409 is a documented already-verified outcome; test_already_verified_requires_original_metadata_and_both_exact_matches proves its separate admission.
        except urllib.error.HTTPError as error:
            if error.code != 409:
                raise
            # Persist the conflict before the GET. A lost lookup can be retried independently.
            attempts.append({"alreadyVerified": True})
            write_json(state_path, state)
            observed = recheck_publication(contract, compiler_metadata, state, state_path, request)
            if observed is None:
                raise ValueError("Sourcify reported existing source, but its public record is not yet visible. Retry the lookup; no sources will be resubmitted.")
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
        if not result["isJobCompleted"]:
            pause(3)
            continue
        if not completed_matching_receipt(contract, attempt):
            raise ValueError(f"Public verification did not match creation and runtime code. See {state_path.name} for the verifier's explanation.")
        observed = recheck_publication(contract, compiler_metadata, state, state_path, request)
        if observed is None:
            raise ValueError("Sourcify completed verification, but its public record is not yet visible. Retry the lookup without resubmitting.")
        return observed
    raise ValueError("Public verification is still pending after five minutes. Rerun source/publish to check the same job; no deployment will be repeated.")


def main():
    requests = Path("/requests")
    if len(sys.argv) > 1 and sys.argv[1] == "import-state":
        for path in sorted(requests.glob("*.request.json")):
            contract = read_json(path)
            key = source_job_key(contract)
            if path.name != f"{key}.request.json":
                raise ValueError("Legacy verification request does not match its selected contract")
            target = Path("/state") / f"{key}.json"
            if not target.exists():
                state = read_publication_state(contract, requests / f"{key}.state.json")
                write_json(target, state)
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "menu":
        if not sys.stdin.isatty():
            raise ValueError("Run source/publish in an interactive terminal to choose contracts; no sources were submitted.")
        keys = choose_contracts(read_json(requests / "catalog.json"), request=request_json, answer=input, output=lambda message: print(message, flush=True))
        (Path("/state") / "selected-keys").write_bytes(b"".join((key + "\0").encode() for key in keys))
        return 0
    # Check the whole batch before the first network request; retries must not partially
    # publish a selection whose later saved inputs are inconsistent.
    prepared_batch = []
    for contract in read_json(requests / "contracts.json"):
        role = contract["key"] if "key" in contract else contract["role"]
        prepared = read_bounded_json(requests / f"{role}.json", SOURCE_REQUEST_MAX_BYTES)
        job = source_job_key(prepared)
        if job != source_job_key(contract) or prepared["location"] != contract["location"] or prepared["sourceCommit"] != contract["sourceCommit"]:
            raise ValueError("Prepared source request differs from the selected contract; no source was submitted for this entry.")
        proof = read_bounded_json(requests / f"{role}.metadata.json", 2 * 1024 * 1024)
        if not isinstance(proof.get("solcMetadata"), dict) or not same_metadata(proof.get("forgeMetadata"), prepared["metadata"]):
            raise ValueError(f"The cached request for {role} differs from its retained compiler artifact.")
        state_path = Path("/state") / f"{job}.json"
        if state_path.exists():
            read_publication_state(prepared, state_path)
        prepared_batch.append((prepared, proof["solcMetadata"], state_path))
    failures = 0
    for prepared, original, state_path in prepared_batch:
        job = source_job_key(prepared)
        print(f"Publishing {prepared['location']['contract']} on chain {prepared['chainId']} at {prepared['identity']['address']}", flush=True)
        try:
            observed = publish_contract(prepared, state_path, compiler_metadata=original,
                                        request=request_json, pause=time.sleep, clock=time.monotonic)
        except urllib.error.HTTPError as error:
            excerpt = error.read(2048).decode("utf-8", errors="replace")
            write_json(Path("/state") / f"{job}-http-error.json", {"status": error.code, "responseExcerpt": excerpt})
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
        print(f"Creation: {MATCH_LABELS[observed['creationMatch']]}. Runtime: {MATCH_LABELS[observed['runtimeMatch']]}.", flush=True)
        print(f"https://repo.sourcify.dev/{prepared['chainId']}/{prepared['identity']['address']}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except EOFError:
        print("Contract selection closed; no sources were submitted.", file=sys.stderr)
        sys.exit(2)
    except (ValueError, urllib.error.URLError, TimeoutError) as error:
        print(f"Cannot publish contract sources: {error}", file=sys.stderr)
        sys.exit(2)
