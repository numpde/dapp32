"""Executable config checks for the narrowed network, secrets and checkout boundaries."""

from __future__ import annotations

from pathlib import Path
import re
import unittest

from .common import compose_volume, read_text, rendered_compose_config, repo_path


REFUND_FILES = ("compose/pay-to-play/refunds/run.yml", "compose/pay-to-play/refunds/execute.yml")


class ConfinementBoundariesTest(unittest.TestCase):
    def test_refund_plan_worker_cannot_egress_and_proxy_cannot_broadcast(self) -> None:
        config = rendered_compose_config("compose/pay-to-play/refunds/run.yml")
        worker = config["services"]["pay-to-play-refunds"]
        proxy = config["services"]["refund-rpc-proxy"]

        self.assertTrue(config["networks"]["refund_rpc_internal"]["internal"])
        self.assertEqual({"refund_rpc_internal"}, set(worker["networks"]))
        self.assertEqual({"refund_rpc_internal", "refund_rpc_egress"}, set(proxy["networks"]))
        self.assertIn("refund-rpc-proxy", worker["depends_on"])
        self.assertEqual("service_healthy", worker["depends_on"]["refund-rpc-proxy"]["condition"])
        self.assertTrue(worker["read_only"])
        self.assertEqual(["ALL"], worker["cap_drop"])
        self.assertTrue(proxy["read_only"])
        self.assertEqual(["ALL"], proxy["cap_drop"])
        self.assertNotIn("eth_sendRawTransaction", proxy["environment"]["RPC_ALLOWED_METHODS"])
        self.assertEqual("262144", proxy["environment"]["RPC_PROXY_MAX_REQUEST_BYTES"])
        self.assertEqual("2097152", proxy["environment"]["RPC_PROXY_MAX_RESPONSE_BYTES"])
        self.assertEqual("4", proxy["environment"]["RPC_PROXY_MAX_QUEUED_REQUESTS"])
        self.assertEqual("NO", worker["environment"]["REFUND_EXECUTE"])

        worker_mounts = {entry["target"]: entry for entry in worker["volumes"]}
        self.assertNotIn("/run/secrets/refund-rpc", worker_mounts)
        self.assertNotIn("/run/secrets/refund-relayer", worker_mounts)
        self.assertNotIn("RPC_URL_FILE", worker["environment"])
        self.assertEqual(
            "http://refund-rpc-proxy:8080", worker["environment"]["REFUND_RPC_PROXY_URL"],
        )

        self.assertEqual("refund_rpc_url", proxy["secrets"][0]["source"])
        self.assertEqual("rpc_url", proxy["secrets"][0]["target"])
        self.assertEqual("/tmp/escrow-release-rpc-url", config["secrets"]["refund_rpc_url"]["file"])

    def test_only_execute_overlay_mounts_relayer_and_permits_broadcast(self) -> None:
        config = rendered_compose_config(REFUND_FILES)
        worker = config["services"]["pay-to-play-refunds"]
        proxy = config["services"]["refund-rpc-proxy"]

        self.assertEqual({"refund_rpc_internal"}, set(worker["networks"]))
        self.assertEqual("YES", worker["environment"]["REFUND_EXECUTE"])
        self.assertTrue(compose_volume(worker, "/run/secrets/refund-relayer")["read_only"])
        self.assertNotIn("/run/secrets/refund-relayer", {
            mount["target"] for mount in (proxy["volumes"] if "volumes" in proxy else ())
        })
        plan = rendered_compose_config(REFUND_FILES[0])["services"]["refund-rpc-proxy"]
        plan_methods = plan["environment"]["RPC_ALLOWED_METHODS"].split()
        execute_methods = proxy["environment"]["RPC_ALLOWED_METHODS"].split()
        self.assertEqual(len(plan_methods), len(set(plan_methods)), "Duplicate plan RPC method")
        self.assertEqual(len(execute_methods), len(set(execute_methods)), "Duplicate execute RPC method")
        self.assertEqual(
            set(plan_methods) | {"eth_sendRawTransaction"},
            set(execute_methods),
            "Execute must add exactly one RPC capability, never drift in read methods",
        )
        for key in ("RPC_PROXY_MAX_REQUEST_BYTES", "RPC_PROXY_MAX_RESPONSE_BYTES", "RPC_PROXY_MAX_QUEUED_REQUESTS"):
            self.assertEqual(plan["environment"][key], proxy["environment"][key])
        self.assertNotIn("secrets", worker, "Worker should only receive protected bind files")

    def test_docs_site_checker_only_reads_its_three_inputs(self) -> None:
        config = rendered_compose_config("compose/docs-site-check.yml")
        checker = config["services"]["docs-site-check"]
        mounts = {mount["target"]: mount for mount in checker["volumes"]}
        self.assertEqual({"/work/docs", "/work/docs_site.py", "/site"}, set(mounts))
        self.assertEqual("none", checker["network_mode"])
        self.assertTrue(all(mount["read_only"] for mount in mounts.values()))
        self.assertFalse(any(mount["bind"].get("create_host_path") is True for mount in mounts.values()))
        self.assertNotIn("/work", mounts)
        self.assertIn("/work/docs_site.py", checker["command"])

    def test_installs_serialize_writes_and_only_clean_their_own_project(self) -> None:
        makefile = read_text(repo_path("Makefile"))
        lock = makefile.split("define dependency_install_lock", 1)[1].split("endef", 1)[0]
        self.assertIn("flock -n 9", lock)
        self.assertIn("sha256sum | cut -c1-40", lock)
        self.assertIn("mkdir -p -m 0700", lock)
        boundaries = [
            ("dapps/deps/install:", ".PHONY: base-images/pull", "solidity-deps"),
            ("js/deps/install:", ".PHONY: source-publication/check", "package-deps"),
        ]
        for first, last, project in boundaries:
            with self.subTest(target=first):
                block = makefile.split(first, 1)[1].split(last, 1)[0]
                self.assertIn("$(dependency_install_lock)", block)
                self.assertIn("mktemp -d", block)
                self.assertIn(project, block)
                self.assertIn("sha256sum | cut -c1-20", block)
                self.assertIn('COMPOSE_PROJECT_NAME="$$compose_project"', block)
                self.assertNotIn('COMPOSE_PROJECT_NAME="$compose_project"', block)
                self.assertIn("disposable_cleanup_command,$$compose_project", block)
                self.assertIn('cleanup_status="$$?"', block)
                self.assertIn('if [[ "$$cleanup_status" != 0 ]]', block)
                self.assertIn("--rmi local", block)

                self.assertNotIn("cleanup_disposable_project,$(DEPS_COMPOSE_PROJECT_NAME)", block)
                self.assertNotIn("cleanup_disposable_project,$(PACKAGE_DEPS_COMPOSE_PROJECT_NAME)", block)

    def test_source_publication_ci_uses_maintained_offline_lanes(self) -> None:
        workflow = read_text(repo_path(".github/workflows/source-publication-checks.yml"))
        self.assertIn("make js/deps/install DOCKER_CONTEXT=default", workflow)
        self.assertIn("make source-publication/check DOCKER_CONTEXT=default", workflow)
        self.assertNotIn("actions/setup-node@", workflow)
        self.assertNotIn("npm ci --ignore-scripts", workflow)

        service = rendered_compose_config("compose/source-publication-check.yml")["services"]["source-publication-check"]
        self.assertEqual("none", service["network_mode"])
        self.assertEqual("none", service["build"]["network"])
        self.assertEqual(
            str(repo_path("containers/node-deps")), service["build"]["context"],
        )

        self.assertTrue(service["read_only"])
        self.assertTrue(all(mount["read_only"] for mount in service["volumes"]))
        self.assertEqual(["ALL"], service["cap_drop"])


if __name__ == "__main__":
    unittest.main()
