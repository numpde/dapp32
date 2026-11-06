"""Protect already-mined local fixtures when starting their browser viewers."""

from __future__ import annotations

import unittest

from .common import ROOT


class LocalDemoGuiLifecycleTest(unittest.TestCase):
    def test_viewer_start_never_recreates_its_deployed_chain(self) -> None:
        source = (ROOT / "Makefile").read_text(encoding="utf-8")
        for app in ("bike-nft", "escrow", "pay-to-play"):
            with self.subTest(app=app):
                start = f"{app}/local/demo/gui/up: dapps/deps/verify"
                end = f"{app}/local/demo/gui/down:"
                self.assertEqual(1, source.count(start))
                self.assertEqual(1, source.count(end))
                recipe = source.split(start, 1)[1].split(end, 1)[0]
                self.assertIn(
                    f"up --build --detach {app}-anvil {app}-cam-http", recipe,
                    "the chain and resource host must be started before the deployment",
                )
                self.assertIn(
                    f"run --build --rm --no-deps deploy-{app}-local", recipe,
                    "deployment must use the already started chain",
                )
                self.assertIn(
                    f"up --build --no-deps --force-recreate --abort-on-container-exit cam-web {app}-browser-gateway",
                    recipe,
                    "the browser must not recreate the chain after its contracts are mined",
                )


if __name__ == "__main__":
    unittest.main()
