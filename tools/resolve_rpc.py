"""Resolve one catalog endpoint offline without publishing credential-bearing diagnostics."""

import argparse
import json
import os
from pathlib import Path
import re
import sys


def unique_fields(pairs):
    fields = {}
    for name, value in pairs:
        if name in fields:
            raise ValueError("RPC catalog contains duplicate object keys.")
        fields[name] = value
    return fields


def select_endpoint(network: str, service: str, expected_chain: str) -> tuple[int, str]:
    with Path(__file__).with_name("rpc-catalog.json").open() as source:
        catalog = json.load(source, object_pairs_hook=unique_fields)
    if not isinstance(catalog, dict):
        raise ValueError("RPC catalog must be a JSON object keyed by network name.")
    if network not in catalog:
        raise ValueError("Unknown RPC_CHAIN; run make release/rpc/list.")
    entry = catalog[network]
    if not isinstance(entry, dict) or set(entry) != {"chainId", "services"}:
        raise ValueError("RPC catalog network must declare chainId and services.")
    chain_id = entry["chainId"]
    if type(chain_id) is not int or chain_id <= 0:
        raise ValueError("RPC catalog chainId must be a positive integer.")
    if expected_chain and str(chain_id) != expected_chain:
        raise ValueError(f"RPC_CHAIN selects chain {chain_id}, but the release expects {expected_chain}.")
    services = entry["services"]
    if not isinstance(services, dict):
        raise ValueError("RPC catalog services must be an object keyed by service name.")
    if service not in services:
        raise ValueError("RPC_SERVICE is unavailable for this chain; run make release/rpc/list.")
    endpoint = services[service]
    if not isinstance(endpoint, str) or not endpoint.startswith("https://"):
        raise ValueError("RPC catalog service must contain an HTTPS URL template.")
    return chain_id, endpoint


def fill_api_key(endpoint: str, supplied: bool) -> str:
    needs_key = "{API_KEY}" in endpoint
    if needs_key != supplied:
        if needs_key:
            raise ValueError("The selected RPC service requires RPC_API_KEY_FILE.")
        raise ValueError("The selected RPC service does not take RPC_API_KEY_FILE.")
    if not needs_key:
        return endpoint
    credential = sys.stdin.buffer.read(258)
    if re.fullmatch(rb"[A-Za-z0-9_-]{1,256}\n?", credential) is None:
        raise ValueError("RPC API key must be 1–256 ASCII letters, digits, underscores or hyphens, with at most one final newline.")
    return endpoint.replace("{API_KEY}", credential.rstrip(b"\n").decode("ascii"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("network")
    parser.add_argument("service")
    parser.add_argument("output", type=Path)
    parser.add_argument("expected_chain")
    parser.add_argument("--api-key-stdin", action="store_true")
    args = parser.parse_args()
    chain_id, template = select_endpoint(args.network, args.service, args.expected_chain)
    endpoint = fill_api_key(template, args.api_key_stdin)
    # Exclusive creation also refuses existing and dangling symlinks.
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as output:
        output.write(endpoint + "\n")
    print(f"RPC selection: {args.network} / {args.service} (chain {chain_id})")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        # JSON exceptions can retain document bytes; report only their location.
        if isinstance(error, json.JSONDecodeError):
            print(f"Cannot resolve RPC: catalog JSON is malformed at line {error.lineno}, column {error.colno}.", file=sys.stderr)
        elif isinstance(error, OSError):
            print(f"Cannot resolve RPC: file operation failed ({error.strerror}).", file=sys.stderr)
        else:
            print(f"Cannot resolve RPC: {error}", file=sys.stderr)
        sys.exit(2)
