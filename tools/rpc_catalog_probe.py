"""Probe dapp32's public RPC catalog and atomically publish one tracked report.

The probe is a read-only, bounded JSON-RPC experiment. It neither signs nor
submits transactions, never supplies API keys, and does not certify event-log
completeness against a dishonest provider. The host publishes only a complete
report from the isolated container process.
"""

import concurrent.futures
import http.client
from datetime import UTC, datetime
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, ProxyHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "js/packages/cam-viewer/src/rpc-catalog.json"
REPORT = ROOT / "notes/046_rpc_capability_report.json"
MAX_RESPONSE_BYTES = 512 * 1024
MAX_REPORT_BYTES = 2 * 1024 * 1024
REQUEST_TIMEOUT = 6
MAX_ENDPOINT_SECONDS = 45
MAX_WORKERS = 4
RUN_TIMEOUT = 720
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
IDENTITY_PRECOMPILE = "0x0000000000000000000000000000000000000004"
IDENTITY_INPUT = "0x636f6e6978"  # 'conix' in hex: a precompile with an exact expected result.
UNKNOWN_HASH = "0x" + "ff" * 32
CHECKS = (
    "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber:sample",
    "eth_getBlockByHash", "eth_getBlockByNumber:finalized",
    "eth_getBlockByNumber:safe", "eth_getLogs:range",
    "eth_getLogs:blockHash", "eth_call:blockHash",
    "eth_call:unknownBlockHash", "eth_getCode:blockHash",
    "eth_getStorageAt:blockHash", "eth_getBalance:blockHash",
    "eth_getTransactionReceipt", "eth_getTransactionByHash",
    "eth_getBlockReceipts", "eth_getBlockByNumber:historical4096",
    "eth_call:historical4096", "eth_getCode:historical4096",
)
HEX = re.compile(r"0x(?:0|[1-9a-f][0-9a-f]*)\Z")
HASH = re.compile(r"0x[0-9a-fA-F]{64}\Z")
ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}\Z")


def pinned_python_image():
    """Reuse the existing reviewed RPC resolver image; no second digest pin."""
    source = (ROOT / "compose/release/rpc.yml").read_text(encoding="utf-8")
    image_lines = re.findall(
        r"^\s*image:\s*(docker\.io/library/python:3\.13-alpine@sha256:[0-9a-f]{64})\s*$",
        source,
        re.MULTILINE,
    )
    if len(image_lines) != 1:
        raise ValueError("The existing RPC resolver has no unique pinned Python image")
    return image_lines[0]


class ProbeFailure(Exception):
    """Stable failure category, with optional numeric HTTP or RPC code only."""

    def __init__(self, category, code=None):
        self.category = category
        self.code = code
        super().__init__(category)


def no_duplicate_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Repeated JSON key")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("Nonfinite JSON constant")


def finite_float(value):
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Nonfinite JSON number")
    return number


def decode_json(payload):
    return json.loads(
        payload,
        object_pairs_hook=no_duplicate_fields,
        parse_constant=reject_constant,
        parse_float=finite_float,
    )


def read_catalog(path):
    raw = path.read_bytes()
    if not 0 < len(raw) <= 256 * 1024:
        raise ValueError("RPC catalog exceeds the admitted size")
    catalog = decode_json(raw)
    if not isinstance(catalog, dict) or not 1 <= len(catalog) <= 64:
        raise ValueError("RPC catalog must contain 1..64 networks")
    for network, definition in catalog.items():
        if not isinstance(network, str) or not isinstance(definition, dict):
            raise ValueError("RPC network entry has an invalid shape")
        if type(definition.get("chainId")) is not int or definition["chainId"] <= 0:
            raise ValueError("RPC network entry has an invalid chain ID")
        services = definition.get("services")
        if not isinstance(services, dict) or len(services) > 12:
            raise ValueError("RPC network services are invalid")
        for service, endpoint in services.items():
            if not isinstance(service, str) or not isinstance(endpoint, str):
                raise ValueError("RPC service endpoint is invalid")
            candidate = endpoint.replace("{API_KEY}", "placeholder")
            parts = urlsplit(candidate)
            if (parts.scheme != "https" or not parts.hostname or parts.username is not None
                    or parts.password is not None or parts.fragment or len(endpoint) > 1024
                    or ("{" in candidate or "}" in candidate)):
                raise ValueError("RPC endpoint must be an HTTPS URL without embedded credentials")
    return catalog, sha256(raw).hexdigest()


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


class JsonRpc:
    def __init__(self, endpoint):
        self.endpoint = endpoint
        self.deadline = time.monotonic() + MAX_ENDPOINT_SECONDS
        # No ambient HTTP(S)_PROXY, Docker-provided proxy settings or redirects.
        self.opener = build_opener(ProxyHandler({}), HTTPSHandler(), NoRedirect())

    def call(self, method, params):
        request_body = json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
        request = Request(
            self.endpoint,
            data=request_body,
            headers={"Content-Type": "application/json", "Accept": "application/json",
                     "Accept-Encoding": "identity", "User-Agent": "dapp32-rpc-capability-probe/1"},
            method="POST",
        )
        started = time.monotonic()
        remaining = self.deadline - started
        if remaining <= 0:
            raise ProbeFailure("endpoint_budget")
        try:
            with self.opener.open(request, timeout=min(REQUEST_TIMEOUT, remaining)) as response:
                if response.status != 200:
                    raise ProbeFailure("http_error", response.status)
                if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise ProbeFailure("unsupported_encoding")
                response_bytes = response.read(MAX_RESPONSE_BYTES + 1)
                if len(response_bytes) > MAX_RESPONSE_BYTES:
                    raise ProbeFailure("response_limit")
        except HTTPError as error:
            code = error.code
            if code in (401, 403):
                raise ProbeFailure("authentication_required", code) from None
            if code == 429:
                raise ProbeFailure("rate_limited", code) from None
            if 300 <= code < 400:
                raise ProbeFailure("redirect_rejected", code) from None
            raise ProbeFailure("http_error", code) from None
        except (TimeoutError, socket.timeout):
            raise ProbeFailure("timeout") from None
        except (URLError, ssl.SSLError, OSError, http.client.HTTPException):
            raise ProbeFailure("transport_error") from None

        try:
            result = decode_json(response_bytes)
        except (UnicodeError, ValueError, RecursionError):
            raise ProbeFailure("malformed_json") from None
        if (type(result) is not dict or result.get("jsonrpc") != "2.0"
                or type(result.get("id")) is not int or result["id"] != 1
                or (("result" in result) == ("error" in result))):
            raise ProbeFailure("invalid_envelope")
        if "error" in result:
            remote_error = result["error"]
            if type(remote_error) is not dict or type(remote_error.get("code")) is not int:
                raise ProbeFailure("invalid_envelope")
            code = remote_error["code"]
            raise ProbeFailure("method_not_found" if code == -32601 else "rpc_error", code)
        return result["result"], int((time.monotonic() - started) * 1000)


def hex_quantity(value):
    if not isinstance(value, str) or HEX.fullmatch(value) is None or len(value) > 66:
        raise ProbeFailure("invalid_result")
    return int(value, 16)


def block_header(value):
    if not isinstance(value, dict) or not isinstance(value.get("hash"), str):
        raise ProbeFailure("invalid_result")
    number = hex_quantity(value.get("number"))
    if (HASH.fullmatch(value["hash"]) is None or type(value.get("parentHash")) is not str
            or HASH.fullmatch(value["parentHash"]) is None):
        raise ProbeFailure("invalid_result")
    return number, value["hash"].lower()


def hex_bytes(value, *, size=None):
    if not isinstance(value, str) or not value.startswith("0x") or len(value) % 2:
        raise ProbeFailure("invalid_result")
    try:
        decoded = bytes.fromhex(value[2:])
    except ValueError:
        raise ProbeFailure("invalid_result") from None
    if size is not None and len(decoded) != size:
        raise ProbeFailure("invalid_result")
    return decoded


def check(rpc, results, name, method, params, validator=None):
    try:
        value, milliseconds = rpc.call(method, params)
        detail = validator(value) if validator is not None else None
        status = {"status": "ok", "ms": milliseconds}
        if isinstance(detail, dict):
            status.update(detail)
        results[name] = status
        return value
    except ProbeFailure as failure:
        status = {"status": failure.category}
        if failure.code is not None:
            status["code"] = failure.code
        results[name] = status
        return None


def validate_logs(value, start, end, expected_hash=None):
    if not isinstance(value, list) or len(value) > 5000:
        raise ProbeFailure("invalid_result")
    for item in value:
        if type(item) is not dict or not isinstance(item.get("topics"), list) or not item["topics"]:
            raise ProbeFailure("invalid_result")
        if not isinstance(item["topics"][0], str) or item["topics"][0].lower() != TRANSFER_TOPIC:
            raise ProbeFailure("inconsistent")
        height = hex_quantity(item.get("blockNumber"))
        block_hash = item.get("blockHash")
        transaction_hash = item.get("transactionHash")
        contract_address = item.get("address")
        if (not start <= height <= end or type(block_hash) is not str
                or HASH.fullmatch(block_hash) is None
                or (expected_hash is not None and block_hash.lower() != expected_hash)):
            raise ProbeFailure("inconsistent")
        if type(transaction_hash) is not str or HASH.fullmatch(transaction_hash) is None:
            raise ProbeFailure("invalid_result")
        hex_quantity(item.get("logIndex"))
        if type(contract_address) is not str or ADDRESS.fullmatch(contract_address) is None:
            raise ProbeFailure("invalid_result")
    return {"matches": len(value)}


def validate_fixed_hash(value, expected_hash):
    _, actual_hash = block_header(value)
    if actual_hash != expected_hash.lower():
        raise ProbeFailure("inconsistent")


def validate_identity_call(value):
    if hex_bytes(value) != bytes.fromhex(IDENTITY_INPUT[2:]):
        raise ProbeFailure("unexpected_result")


def validate_empty_or_code(value):
    hex_bytes(value)


def validate_storage(value):
    hex_bytes(value, size=32)


def validate_bal(value):
    hex_quantity(value)


def validate_tagged_block(value):
    if value is None:
        raise ProbeFailure("unavailable")
    block_header(value)


def validate_receipt(value, expected_hash):
    if value is None:
        raise ProbeFailure("unavailable")
    if (type(value) is not dict or type(value.get("blockHash")) is not str
            or value["blockHash"].lower() != expected_hash):
        raise ProbeFailure("inconsistent")
    if type(value.get("transactionHash")) is not str or HASH.fullmatch(value["transactionHash"]) is None:
        raise ProbeFailure("invalid_result")


def validate_transaction(value, expected_hash):
    if value is None:
        raise ProbeFailure("unavailable")
    if (type(value) is not dict or type(value.get("hash")) is not str
            or value["hash"].lower() != expected_hash):
        raise ProbeFailure("inconsistent")


def verify_block_receipts(value, block_hash):
    if not isinstance(value, list):
        raise ProbeFailure("invalid_result")
    for receipt in value:
        if (type(receipt) is not dict or type(receipt.get("blockHash")) is not str
                or receipt["blockHash"].lower() != block_hash):
            raise ProbeFailure("inconsistent")
    return {"receipts": len(value)}


def probe_provider(network, service, endpoint, expected_chain):
    result = {"endpoint": endpoint, "status": "probed", "checks": {}}
    rpc = JsonRpc(endpoint)
    checks = result["checks"]

    chain = check(rpc, checks, "eth_chainId", "eth_chainId", [], hex_quantity)
    if chain is None:
        result["status"] = "source_unavailable"
        return result
    if int(chain, 16) != expected_chain:
        result["status"] = "wrong_chain"
        result["observed_chain_id"] = int(chain, 16)
        return result

    height = check(rpc, checks, "eth_blockNumber", "eth_blockNumber", [], hex_quantity)
    if height is None:
        result["status"] = "head_unavailable"
        return result
    head_number = hex_quantity(height)
    selected_height = max(0, head_number - 2)
    result["head_height"] = head_number

    header = check(
        rpc, checks, "eth_getBlockByNumber:sample", "eth_getBlockByNumber",
        [hex(selected_height), False],
        lambda value: {"height": block_header(value)[0]},
    )
    if header is None:
        result["status"] = "sample_unavailable"
        return result
    header_height, block_hash = block_header(header)
    if header_height != selected_height:
        checks["eth_getBlockByNumber:sample"] = {"status": "inconsistent"}
        result["status"] = "sample_unavailable"
        return result
    result["sample"] = {"block": selected_height, "hash": block_hash}

    check(rpc, checks, "eth_getBlockByHash", "eth_getBlockByHash", [block_hash, False],
          lambda value: validate_fixed_hash(value, block_hash))
    for tag in ("safe", "finalized"):
        check(rpc, checks, f"eth_getBlockByNumber:{tag}", "eth_getBlockByNumber", [tag, False],
              validate_tagged_block)

    first_height = max(0, selected_height - 3)
    range_logs = check(
        rpc, checks, "eth_getLogs:range", "eth_getLogs",
        [{"fromBlock": hex(first_height), "toBlock": hex(selected_height), "topics": [TRANSFER_TOPIC]}],
        lambda value: validate_logs(value, first_height, selected_height),
    )
    observed_log = range_logs[0] if isinstance(range_logs, list) and range_logs else None
    log_block = observed_log["blockHash"].lower() if observed_log else block_hash
    log_filter = {"blockHash": log_block, "topics": [TRANSFER_TOPIC]}
    if observed_log:
        log_filter["address"] = observed_log["address"]

    hash_logs = check(
        rpc, checks, "eth_getLogs:blockHash", "eth_getLogs", [log_filter],
        lambda value: validate_logs(
            value,
            hex_quantity(observed_log["blockNumber"]) if observed_log else selected_height,
            hex_quantity(observed_log["blockNumber"]) if observed_log else selected_height,
            expected_hash=log_block,
        ),
    )
    if observed_log and hash_logs is not None:
        identity = (observed_log["transactionHash"].lower(), hex_quantity(observed_log["logIndex"]))
        identities = {(item["transactionHash"].lower(), hex_quantity(item["logIndex"])) for item in hash_logs}
        if identity not in identities:
            checks["eth_getLogs:blockHash"] = {"status": "inconsistent"}
    elif range_logs == []:
        checks["eth_getLogs:range"]["status"] = "inconclusive_empty"
        if hash_logs:
            checks["eth_getLogs:blockHash"] = {"status": "inconsistent"}
        elif hash_logs == []:
            checks["eth_getLogs:blockHash"]["status"] = "inconclusive_empty"
    elif hash_logs == []:
        checks["eth_getLogs:blockHash"]["status"] = "inconclusive_empty"

    precompile_call = [{"to": IDENTITY_PRECOMPILE, "data": IDENTITY_INPUT},
                       {"blockHash": block_hash, "requireCanonical": True}]
    check(rpc, checks, "eth_call:blockHash", "eth_call", precompile_call, validate_identity_call)
    # A nonexistent hash must *not* be treated as the latest block.
    check(rpc, checks, "eth_call:unknownBlockHash", "eth_call",
          [{"to": IDENTITY_PRECOMPILE, "data": IDENTITY_INPUT},
           {"blockHash": UNKNOWN_HASH, "requireCanonical": True}])
    unknown_status = checks["eth_call:unknownBlockHash"]["status"]
    if unknown_status == "ok":
        checks["eth_call:unknownBlockHash"] = {"status": "inconsistent_accepted_nonexistent_hash"}
    elif unknown_status == "rpc_error":
        checks["eth_call:unknownBlockHash"]["status"] = "rejected_unknown_hash"

    check(rpc, checks, "eth_getCode:blockHash", "eth_getCode",
          [IDENTITY_PRECOMPILE, {"blockHash": block_hash, "requireCanonical": True}],
          validate_empty_or_code)
    check(rpc, checks, "eth_getStorageAt:blockHash", "eth_getStorageAt",
          [IDENTITY_PRECOMPILE, "0x0", {"blockHash": block_hash, "requireCanonical": True}],
          validate_storage)
    check(rpc, checks, "eth_getBalance:blockHash", "eth_getBalance",
          [IDENTITY_PRECOMPILE, {"blockHash": block_hash, "requireCanonical": True}], validate_bal)

    transactions = header.get("transactions", [])
    transaction_hash = transactions[0] if isinstance(transactions, list) and transactions else None
    if not transaction_hash and observed_log:
        transaction_hash = observed_log["transactionHash"]
    if transaction_hash and HASH.fullmatch(transaction_hash):
        check(rpc, checks, "eth_getTransactionReceipt", "eth_getTransactionReceipt", [transaction_hash],
              lambda value: validate_receipt(value, log_block if observed_log and transaction_hash == observed_log["transactionHash"] else block_hash))
        check(rpc, checks, "eth_getTransactionByHash", "eth_getTransactionByHash", [transaction_hash],
              lambda value: validate_transaction(value, transaction_hash.lower()))
    else:
        checks["eth_getTransactionReceipt"] = {"status": "inconclusive_no_transaction"}
        checks["eth_getTransactionByHash"] = {"status": "inconclusive_no_transaction"}

    check(rpc, checks, "eth_getBlockReceipts", "eth_getBlockReceipts", [hex(selected_height)],
          lambda value: verify_block_receipts(value, block_hash))

    historical = max(0, selected_height - 4096)
    old_block = check(
        rpc, checks, "eth_getBlockByNumber:historical4096", "eth_getBlockByNumber",
        [hex(historical), False],
        lambda value: {"height": block_header(value)[0]},
    )
    if old_block is not None:
        historical_height, historical_hash = block_header(old_block)
        if historical_height != historical:
            checks["eth_getBlockByNumber:historical4096"] = {"status": "inconsistent"}
            checks["eth_call:historical4096"] = {"status": "not_checked"}
            checks["eth_getCode:historical4096"] = {"status": "not_checked"}
        else:
            check(rpc, checks, "eth_call:historical4096", "eth_call",
                  [{"to": IDENTITY_PRECOMPILE, "data": IDENTITY_INPUT},
                   {"blockHash": historical_hash, "requireCanonical": True}], validate_identity_call)
            if observed_log:
                check(rpc, checks, "eth_getCode:historical4096", "eth_getCode",
                      [observed_log["address"], {"blockHash": historical_hash, "requireCanonical": True}],
                      validate_empty_or_code)
            else:
                checks["eth_getCode:historical4096"] = {"status": "inconclusive_no_contract"}
    else:
        checks["eth_call:historical4096"] = {"status": "not_checked"}
        checks["eth_getCode:historical4096"] = {"status": "not_checked"}
    return result


def probe_catalog(catalog, catalog_digest):
    targets = [(network, service, url, metadata["chainId"])
               for network, metadata in catalog.items()
               for service, url in metadata["services"].items()
               if "{API_KEY}" not in url]
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(probe_provider, *target): target[:2] for target in targets}
        for future in concurrent.futures.as_completed(futures):
            network, service = futures[future]
            results[(network, service)] = future.result()
            print(f"RPC probe: {network}/{service}: {results[(network, service)]['status']}", file=sys.stderr)

    networks = {}
    for network, metadata in catalog.items():
        services = {}
        for service, url in metadata["services"].items():
            services[service] = (
                {"endpoint_template": url, "status": "requires_api_key", "checks": {}}
                if "{API_KEY}" in url else results[(network, service)]
            )
        networks[network] = {
            "chain_id": metadata["chainId"], "retired": metadata.get("retired") is True,
            "services": services,
        }

    services = [service for network in networks.values() for service in network["services"].values()]
    summary = {
        "networks": len(networks),
        "endpoints": len(services),
        "keyless": len(targets),
        "requires_api_key": sum(service["status"] == "requires_api_key" for service in services),
        "chain_verified": sum(service["status"] == "probed" for service in services),
    }

    return {
        "schema": 1,
        "state": "complete",
        "summary": summary,
        "generated_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "catalog": "js/packages/cam-viewer/src/rpc-catalog.json",
        "catalog_sha256": catalog_digest,
        "method_checks": list(CHECKS),
        "scope": {
            "credentials": "none; API-key endpoints not contacted",
            "read_only": True,
            "historical_depth_blocks": 4096,
            "max_parallel_endpoints": MAX_WORKERS,
            "timeout_seconds_per_call": REQUEST_TIMEOUT,
            "budget_seconds_per_endpoint": MAX_ENDPOINT_SECONDS,
            "probe": "Recent sample: head-2; Transfer logs in up to four blocks; identity precompile at hash.",
            "caveat": "Method acceptance is not proof of complete logs, archive state, finality or provider honesty.",
        },
        "networks": networks,
    }


def validate_report(report, catalog, digest):
    if (type(report) is not dict or report.get("schema") != 1 or report.get("state") != "complete"
            or report.get("catalog_sha256") != digest
            or report.get("catalog") != "js/packages/cam-viewer/src/rpc-catalog.json"
            or report.get("method_checks") != list(CHECKS)
            or not isinstance(report.get("generated_at_utc"), str)):
        raise ValueError("Probe result does not describe the selected catalog and method set")
    networks = report.get("networks")
    if type(networks) is not dict or set(networks) != set(catalog):
        raise ValueError("Probe result omits or invents catalog networks")
    usable_sources = 0
    for network, source in catalog.items():
        observed = networks[network]
        if type(observed) is not dict or observed.get("chain_id") != source["chainId"]:
            raise ValueError("Probe result has an inconsistent chain identity")
        providers = observed.get("services")
        if type(providers) is not dict or set(providers) != set(source["services"]):
            raise ValueError("Probe result omits or invents providers")
        for service, endpoint in source["services"].items():
            result = providers[service]
            if type(result) is not dict or not isinstance(result.get("checks"), dict):
                raise ValueError("Probe provider result is invalid")
            if "{API_KEY}" in endpoint:
                if result.get("status") != "requires_api_key" or result.get("endpoint_template") != endpoint or result["checks"]:
                    raise ValueError("Credential-dependent endpoint was not skipped")
                continue
            if result.get("endpoint") != endpoint or result.get("status") not in (
                "probed", "source_unavailable", "head_unavailable",
                "sample_unavailable", "wrong_chain",
            ):
                raise ValueError("Probe result has an invalid keyless-provider state")
            checks = result["checks"]
            if any(name not in CHECKS or type(details) is not dict or not isinstance(details.get("status"), str)
                   for name, details in checks.items()):
                raise ValueError("Probe result has an invalid method result")
            if result.get("status") == "probed":
                if set(checks) != set(CHECKS):
                    raise ValueError("A probed endpoint has missing method results")
                if checks["eth_chainId"]["status"] != "ok":
                    raise ValueError("Probed endpoint never established its chain")
                usable_sources += 1
    summary = report.get("summary")
    expected_summary = {
        "networks": len(catalog),
        "endpoints": sum(len(entry["services"]) for entry in catalog.values()),
        "keyless": sum("{API_KEY}" not in endpoint for entry in catalog.values()
                       for endpoint in entry["services"].values()),
        "requires_api_key": sum("{API_KEY}" in endpoint for entry in catalog.values()
                                for endpoint in entry["services"].values()),
        "chain_verified": usable_sources,
    }
    if summary != expected_summary:
        raise ValueError("Probe summary disagrees with the exact catalog coverage")
    if usable_sources == 0:
        raise ValueError("No endpoint established a valid source; refusing to replace the prior report")


def report_bytes(report):
    raw = (json.dumps(report, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    if not 0 < len(raw) <= MAX_REPORT_BYTES:
        raise ValueError("Probe report exceeds bounded output size")
    return raw


def publish_atomic(report_path, payload):
    """Replace the fixed tracked report once; preserve it after any failure."""
    if report_path.is_symlink() or report_path.parent.is_symlink():
        raise ValueError("Tracked report and its parent must not be symlinks")
    present = report_path.stat()
    if not stat.S_ISREG(present.st_mode) or present.st_uid != os.getuid():
        raise ValueError("Tracked report must be an owned regular file")
    previous_digest = sha256(report_path.read_bytes()).digest()
    mode = stat.S_IMODE(present.st_mode)
    file_descriptor, temp_name = tempfile.mkstemp(prefix=".rpc-capability-", dir=report_path.parent)
    try:
        with os.fdopen(file_descriptor, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        if report_path.is_symlink() or sha256(report_path.read_bytes()).digest() != previous_digest:
            raise ValueError("Tracked report changed during the probe; refusing to overwrite concurrent work")
        os.replace(temp_name, report_path)
        directory_fd = os.open(report_path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def publish_via_docker(endpoint):
    if not endpoint.startswith("unix://") or not endpoint.removeprefix("unix://").startswith("/"):
        raise ValueError("RPC probe requires the Make-selected local Unix-socket Docker Engine")
    catalog, digest = read_catalog(CATALOG)
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", "--", REPORT.relative_to(ROOT).as_posix()],
        cwd=ROOT, capture_output=True, check=False, timeout=10,
    )
    if tracked.returncode != 0:
        raise ValueError("The fixed RPC report must already be tracked by Git")
    container_name = "dapp32-rpc-probe-" + secrets.token_hex(8)
    with tempfile.TemporaryDirectory(prefix="dapp32-rpc-probe-docker-") as docker_config:
        docker_command = ["docker", "--config", docker_config, "--host", endpoint]
        argv = [
            *docker_command, "run", "--rm", "--name", container_name,
            "--pull", "missing", "--network", "bridge", "--read-only",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--pids-limit", "64", "--memory", "256m", "--cpus", "1",
            "--user", "65534:65534", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=8m",
            "--mount", f"type=bind,source={Path(__file__).resolve()},target=/probe.py,readonly",
            "--mount", f"type=bind,source={CATALOG},target=/catalog.json,readonly",
            "--entrypoint", "python3", pinned_python_image(),
            "-I", "-B", "/probe.py", "probe", "/catalog.json",
        ]
        try:
            child = subprocess.run(argv, capture_output=True, timeout=RUN_TIMEOUT, check=False)
        except subprocess.TimeoutExpired:
            # A timed-out Docker CLI may leave its daemon-owned container alive.
            # Retire only the exact unpredictable name we created.
            try:
                retired = subprocess.run([*docker_command, "rm", "--force", container_name],
                                         capture_output=True, timeout=15, check=False)
            except (OSError, subprocess.TimeoutExpired):
                raise ValueError(f"RPC probe timed out; cleanup unconfirmed for {container_name}") from None
            if retired.returncode:
                raise ValueError(f"RPC probe timed out; cleanup unconfirmed for {container_name}") from None
            raise ValueError("RPC probe exceeded its overall deadline; prior report retained") from None
        if child.returncode != 0:
            raise ValueError(f"RPC probe container failed (exit {child.returncode}); prior report retained")
        if len(child.stdout) > MAX_REPORT_BYTES:
            raise ValueError("RPC probe container report exceeded its size limit")
        report = decode_json(child.stdout)
        validate_report(report, catalog, digest)
        publish_atomic(REPORT, report_bytes(report))
        providers = [v for row in report["networks"].values() for v in row["services"].values()]
        probed = sum(v.get("status") == "probed" for v in providers)
        skipped = sum(v.get("status") == "requires_api_key" for v in providers)
        print(f"RPC probe: published {REPORT.relative_to(ROOT)}; {probed} chain-verified, {skipped} key-required (skipped).")


def main(argv):
    if len(argv) == 3 and argv[1] == "probe":
        catalog, digest = read_catalog(Path(argv[2]))
        output = probe_catalog(catalog, digest)
        sys.stdout.buffer.write(report_bytes(output))
        return 0
    if len(argv) == 3 and argv[1] == "publish":
        publish_via_docker(argv[2])
        return 0
    print("Usage: rpc_catalog_probe.py probe <catalog.json> | publish <selected-unix-Docker-endpoint>", file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv))
    except (ValueError, OSError) as failure:
        # Never print remote response, proxy or URL material in diagnostics.
        print(f"RPC probe: {failure}", file=sys.stderr)
        raise SystemExit(2) from None
