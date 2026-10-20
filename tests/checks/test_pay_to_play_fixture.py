from __future__ import annotations

from copy import deepcopy
import unittest
from unittest.mock import patch

from tools.pay_to_play_fixture import describe_fixture


PROJECT = "dapps-pay-to-play-fixture-check"
NETWORK = PROJECT + "_pay-to-play_local"
RPC_URL = "http://pay-to-play-anvil:8545"


class PayToPlayFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.transactions = [
            {"transactionType": "CREATE", "contractName": name,
             "contractAddress": "0x" + byte * 40, "hash": "0x" + byte * 64}
            for name, byte in (("CamRoot", "1"), ("PayToPlay", "2"))
        ]
        self.transactions.append({"transactionType": "CALL", "hash": "0x" + "3" * 64})
        self.receipts = {
            tx["hash"]: {"transactionHash": tx["hash"], "status": "0x1",
                         "contractAddress": tx.get("contractAddress"),
                         "blockNumber": hex(index + 1), "blockHash": "0x" + str(index + 4) * 64}
            for index, tx in enumerate(self.transactions)
        }
        self.broadcast = {"transactions": self.transactions, "receipts": list(deepcopy(self.receipts).values())}
        self.accounts = {
            role: {"address": "0x" + byte * 40, "privateKey": "0x" + byte * 64}
            for role, byte in (("admin", "a"), ("customer", "b"), ("relayer", "c"), ("payee", "d"))
        }

    def rpc(self, url: str, method: str, params: list[object]) -> object:
        self.assertEqual(RPC_URL, url)
        if method == "eth_chainId":
            return "0x7a69"
        if method == "eth_getTransactionReceipt":
            return self.receipts.get(params[0])
        if method == "eth_getCode":
            return "0x6000"
        self.fail(f"unexpected RPC method {method}")

    def describe(self) -> dict[str, object]:
        return describe_fixture(self.broadcast, self.accounts, PROJECT, NETWORK, RPC_URL)

    def test_exports_live_deployment_and_public_roles_for_external_consumer(self) -> None:
        with patch("tools.pay_to_play_fixture.rpc_call", side_effect=self.rpc):
            result = self.describe()
        self.assertEqual(PROJECT, result["composeProject"])
        self.assertEqual(NETWORK, result["dockerNetwork"])
        self.assertEqual(RPC_URL, result["rpcUrl"])
        self.assertEqual(31337, result["chainId"])
        self.assertEqual(self.accounts, result["publicFixtureAccounts"])
        self.assertEqual({
            "CamRoot": {"address": self.transactions[0]["contractAddress"], "deploymentBlock": 1},
            "PayToPlay": {"address": self.transactions[1]["contractAddress"], "deploymentBlock": 2},
        }, result["contracts"])

    def test_missing_failed_or_reorganized_receipts_prevent_export(self) -> None:
        for index in range(3):
            tx_hash = self.transactions[index]["hash"]
            original = deepcopy(self.receipts[tx_hash])
            for replacement in (None, {**original, "status": "0x0"}, {**original, "blockHash": "0x" + "f" * 64}):
                with self.subTest(transaction=index, replacement=replacement):
                    self.receipts[tx_hash] = replacement
                    with patch("tools.pay_to_play_fixture.rpc_call", side_effect=self.rpc):
                        with self.assertRaisesRegex(ValueError, "receipt"):
                            self.describe()
            self.receipts[tx_hash] = original

    def test_wrong_chain_and_missing_contract_code_prevent_export(self) -> None:
        for method, replacement in (("eth_chainId", "0x1"), ("eth_getCode", "0x")):
            def changed_rpc(url: str, called: str, params: list[object]) -> object:
                return replacement if called == method else self.rpc(url, called, params)
            with self.subTest(method=method), patch("tools.pay_to_play_fixture.rpc_call", side_effect=changed_rpc):
                with self.assertRaises(ValueError):
                    self.describe()

    def test_malformed_receipt_block_numbers_explain_why_export_failed(self) -> None:
        tx_hash = self.transactions[0]["hash"]
        for block_number in (None, True, 1, "not-hexadecimal"):
            self.receipts[tx_hash]["blockNumber"] = block_number
            self.broadcast["receipts"][0]["blockNumber"] = block_number
            with self.subTest(block_number=block_number), patch("tools.pay_to_play_fixture.rpc_call", side_effect=self.rpc):
                with self.assertRaisesRegex(ValueError, "receipt"):
                    self.describe()

    def test_ambiguous_or_malformed_deployments_prevent_export(self) -> None:
        original = deepcopy(self.broadcast)
        malformed = (
            {"transactions": self.transactions[1:], "receipts": original["receipts"]},
            {"transactions": self.transactions + [self.transactions[0]], "receipts": original["receipts"]},
            {"transactions": [{**self.transactions[0], "contractAddress": "bad"}] + self.transactions[1:], "receipts": original["receipts"]},
        )
        for broadcast in malformed:
            with self.subTest(broadcast=broadcast), patch("tools.pay_to_play_fixture.rpc_call", side_effect=self.rpc):
                self.broadcast = broadcast
                with self.assertRaises(ValueError):
                    self.describe()

    def test_missing_role_or_invalid_key_prevents_export_without_echoing_key(self) -> None:
        for role in tuple(self.accounts):
            original = self.accounts[role]
            for replacement in (None, {**original, "privateKey": "sensitive-value"}):
                with self.subTest(role=role), patch("tools.pay_to_play_fixture.rpc_call", side_effect=self.rpc):
                    self.accounts[role] = replacement
                    with self.assertRaises(ValueError) as caught:
                        self.describe()
                    self.assertNotIn("sensitive-value", str(caught.exception))
            self.accounts[role] = original
