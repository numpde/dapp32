"""Export a disposable deployment only after its receipts and code match the live chain."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen


def rpc_call(url: str, method: str, params: list[object]) -> object:
    request = Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                      headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=5) as response:
        content = response.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        raise ValueError(f"Fixture RPC {method} response exceeds 1 MiB")
    result = json.loads(content)
    if not isinstance(result, dict) or result.get("id") != 1 or "result" not in result or "error" in result:
        raise ValueError(f"Fixture RPC {method} returned an unsuccessful response: {result}")
    return result["result"]


def describe_fixture(broadcast: object, accounts: object, project: str, network: str, rpc_url: str) -> dict[str, object]:
    if rpc_call(rpc_url, "eth_chainId", []) != "0x7a69":
        raise ValueError("Cannot export fixture: RPC chain ID must be 31337")
    if not isinstance(broadcast, dict) or not isinstance(broadcast.get("transactions"), list) or not isinstance(broadcast.get("receipts"), list):
        raise ValueError("Cannot export fixture: Forge broadcast must contain transactions and receipts arrays")
    if not isinstance(accounts, dict) or set(accounts) != {"admin", "customer", "relayer", "payee"}:
        raise ValueError("Cannot export fixture: public accounts must contain admin, customer, relayer and payee")
    for role, account in accounts.items():
        if (not isinstance(account, dict)
                or not isinstance(account.get("address"), str)
                or re.fullmatch(r"0x[0-9a-fA-F]{40}", account["address"]) is None
                or not isinstance(account.get("privateKey"), str)
                or re.fullmatch(r"0x[0-9a-fA-F]{64}", account["privateKey"]) is None):
            raise ValueError(f"Cannot export fixture: {role} needs a valid public fixture address and key")

    expected_contracts = {"CamRoot", "PayToPlay", "PayToPlayUI"}
    contracts: dict[str, object] = {}
    for tx in broadcast["transactions"]:
        if not isinstance(tx, dict) or not isinstance(tx.get("hash"), str) or re.fullmatch(r"0x[0-9a-fA-F]{64}", tx["hash"]) is None:
            raise ValueError("Cannot export fixture: deployment transaction hash is missing or malformed")
        receipt = rpc_call(rpc_url, "eth_getTransactionReceipt", [tx["hash"]])
        recorded = [item for item in broadcast["receipts"] if isinstance(item, dict) and item.get("transactionHash") == tx["hash"]]
        if (not isinstance(receipt, dict) or receipt.get("status") != "0x1"
                or receipt.get("transactionHash") != tx["hash"] or len(recorded) != 1
                or not isinstance(receipt.get("blockHash"), str)
                or receipt["blockHash"] != recorded[0].get("blockHash")
                or not isinstance(receipt.get("blockNumber"), str)
                or re.fullmatch(r"0x[0-9a-fA-F]+", receipt["blockNumber"]) is None
                or receipt.get("blockNumber") != recorded[0].get("blockNumber")):
            raise ValueError(f"Cannot export fixture: deployment receipt is missing, malformed, failed or changed for {tx['hash']}")
        if tx.get("transactionType") != "CREATE":
            continue
        name = tx.get("contractName")
        address = tx.get("contractAddress")
        if name not in expected_contracts or name in contracts:
            raise ValueError("Cannot export fixture: expected one CamRoot, one PayToPlay and one PayToPlayUI creation")
        if (not isinstance(address, str) or re.fullmatch(r"0x[0-9a-fA-F]{40}", address) is None
                or str(receipt.get("contractAddress")).lower() != address.lower()):
            raise ValueError(f"Cannot export fixture: {name} deployment address does not match its receipt")
        code = rpc_call(rpc_url, "eth_getCode", [address, "latest"])
        if not isinstance(code, str) or re.fullmatch(r"0x(?:[0-9a-fA-F]{2})+", code) is None:
            raise ValueError(f"Cannot export fixture: {name} has no deployed code at {address}")
        contracts[name] = {"address": address, "deploymentBlock": int(receipt["blockNumber"], 16)}
    if set(contracts) != expected_contracts:
        raise ValueError("Cannot export fixture: expected one CamRoot, one PayToPlay and one PayToPlayUI creation")
    return {"composeProject": project, "dockerNetwork": network, "rpcUrl": rpc_url, "chainId": 31337,
            "contracts": contracts, "publicFixtureAccounts": accounts}


def main() -> None:
    # Isolated Python execution needs the mounted tools package's parent on its import path.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from tools.json_policy import read_strict_json

    try:
        descriptor = describe_fixture(
            read_strict_json(Path(os.environ["PAY_TO_PLAY_BROADCAST_PATH"])),
            read_strict_json(Path(os.environ["PAY_TO_PLAY_BROADCAST_DIR"]) / "public-accounts.json"),
            os.environ["COMPOSE_PROJECT_NAME"], os.environ["PAY_TO_PLAY_FIXTURE_NETWORK"],
            "http://pay-to-play-anvil:8545",
        )
    except (OSError, ValueError, URLError) as error:
        raise SystemExit(f"pay-to-play fixture: {error}") from error
    print(json.dumps(descriptor, indent=2))


if __name__ == "__main__":
    main()
