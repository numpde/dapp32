"""Contract checks for the six authored Pay-to-Play task destinations.

These check navigation and write ownership using the publication source; live
wallet, session-state and receipt behavior is exercised by the JS/browser suites.
"""

from __future__ import annotations

import json
import unittest

from .common import ROOT


CAM = ROOT / "dapps/pay-to-play/cam"
DESTINATIONS = (
    ("balance", "Balance", "position"),
    ("deposit", "Deposit", "depositForm"),
    ("withdrawal", "Withdraw or move", "withdrawalForm"),
    ("vouchers", "Vouchers", "voucherPaymentsForm"),
    ("recovery", "Recovery", "recovery"),
    ("channelSettings", "Channel settings", "channelSettingsForm"),
)
EDITORS = {
    "position": set(),
    "depositForm": {"fund"},
    "withdrawalForm": {"requestWithdrawal", "setWithdrawal", "withdraw", "move"},
    "voucherPaymentsForm": {"registerVoucherKey", "voucherDigest", "collect"},
    "recovery": {"renewPosition", "setRefundRecipient", "closePosition", "refund", "closeChannel"},
    "channelSettingsForm": {"setPayee", "setCollector"},
}
WRITES = set().union(*EDITORS.values()) - {"voucherDigest"}


def authored_calls(node: dict, nodes: dict, seen: frozenset[str]) -> list[str]:
    if node["element"] == "Button":
        call = node["call"]
        return [call["function"]] if call["namespace"] == "routes" else []
    if node["element"] == "Include":
        name = node["call"]["function"]
        if name.startswith("$"):
            return []
        if name in seen:
            raise AssertionError(f"Recursive UI Include: {name}")
        return authored_calls(nodes[name], nodes, seen | {name})
    if node["element"] in ("Screen", "Fragment"):
        return [name for child in node["children"]
                for name in authored_calls(child, nodes, seen)]
    return []


class PayToPlayNavigationContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.cam = json.loads((CAM / "main.json").read_text(encoding="utf-8"))
        self.nodes = json.loads((CAM / "ui.json").read_text(encoding="utf-8"))["nodes"]

    def test_each_task_is_a_fresh_authoritative_read_of_the_inspected_position(self) -> None:
        baseline = self.cam["routes"]["position"]["call"]
        self.assertEqual(["customer", "channelId"], self.cam["routes"]["position"]["inputs"])
        for task, _, route in DESTINATIONS:
            with self.subTest(task=task):
                declared = self.cam["routes"][route]
                self.assertEqual("read", declared["kind"])
                self.assertEqual(["customer", "channelId"], declared["inputs"])
                self.assertEqual(baseline, declared["call"], "task reads must preserve actor/owner separation")
                view = declared["then"]["args"]["view"]
                self.assertEqual("app", declared["then"]["function"])
                self.assertEqual("balanceSection.selected", view["balanceSection"])
                self.assertEqual(f"taskNavigation.{task}", view["taskNavigation"])
                self.assertEqual("$outputs.0", view["task"])
                self.assertIn(view["screen"], self.nodes)

    def test_one_navigation_owns_stable_order_and_inert_current_task(self) -> None:
        self.assertNotIn("positionFields", self.nodes, "retire the overloaded balance screen")
        for current, _, _ in DESTINATIONS:
            with self.subTest(current=current):
                menu = self.nodes[f"taskNavigation.{current}"]
                self.assertEqual("Screen", menu["element"])
                self.assertEqual("Balance tasks", menu["props"]["title"])
                includes = menu["children"]
                self.assertEqual(6, len(includes))
                for slot, (task, label, route) in zip(includes, DESTINATIONS, strict=True):
                    self.assertEqual("Include", slot["element"])
                    item = self.nodes[slot["call"]["function"]]
                    self.assertEqual("Text" if current == task else "Button", item["element"])
                    if current == task:
                        self.assertIn(label, item["props"]["text"])
                        self.assertIn("current", item["props"]["text"].lower())
                    else:
                        self.assertEqual(label, item["props"]["label"])
                        self.assertEqual(route, item["call"]["function"])
                        self.assertEqual({"customer": "$view.customer", "channelId": "$view.channelId"},
                                         item["call"]["args"])

    def test_route_editors_are_separate_and_all_contract_writes_unchanged(self) -> None:
        for _, _, route in DESTINATIONS:
            with self.subTest(route=route):
                screen = self.cam["routes"][route]["then"]["args"]["view"]["screen"]
                calls = set(authored_calls(self.nodes[screen], self.nodes, frozenset()))
                self.assertEqual(EDITORS[route], calls & (WRITES | {"voucherDigest"}))
        self.assertEqual(set(), set(authored_calls(self.nodes["position"], self.nodes, frozenset())) & WRITES,
                         "balance is an overview, never an omnibus editor")

    def test_lookup_stays_separate_and_voucher_details_remain_read_only(self) -> None:
        for route in ("home", "channelLookup", "createChannelForm", "choosePosition"):
            self.assertEqual("taskNavigation.none",
                             self.cam["routes"][route]["then"]["args"]["view"]["taskNavigation"])
        self.assertEqual("taskNavigation.vouchers",
                         self.cam["routes"]["voucherDigest"]["then"]["args"]["view"]["taskNavigation"])
        self.assertEqual("read", self.cam["routes"]["voucherDigest"]["kind"])
        self.assertEqual(set(), set(authored_calls(self.nodes["voucher"], self.nodes, frozenset())) & WRITES)


if __name__ == "__main__":
    unittest.main()
