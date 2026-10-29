from __future__ import annotations

import json
import unittest

from .common import repo_path


class EscrowCreditCopyTest(unittest.TestCase):
    def test_credit_screens_limit_aggregate_to_this_escrow_and_exclude_locked_funds(self) -> None:
        ui = json.loads(repo_path("dapps/escrow/cam/ui.json").read_text(encoding="utf-8"))

        for screen_id in ("escrow.credit.empty", "escrow.credit.available"):
            with self.subTest(screen=screen_id):
                children = ui["nodes"][screen_id]["children"]
                credit_status = next(
                    index
                    for index, child in enumerate(children)
                    if child["element"] == "Status"
                    and child["props"]["label"] == "Total withdrawable credit for this account (wei)"
                )
                paragraphs = []
                for child in children[credit_status + 1:]:
                    if child["element"] != "Text":
                        break
                    paragraphs.append(child["props"]["text"])
                description = " ".join(paragraphs)

                self.assertIn(
                    "Settling an agreement records credit rather than sending money straight to a wallet.",
                    description,
                )
                self.assertIn(
                    "This total combines credit from all ended agreements in this escrow for the account being viewed, less previous withdrawals.",
                    description,
                )
                self.assertIn("It excludes funds still locked in open agreements.", description)
