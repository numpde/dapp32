from __future__ import annotations

import unittest

from .common import compose_mapping, compose_sequence_or_empty, compose_service, rendered_compose_config
from .text.test_rendered_compose_posture import makefile_compose_units, release_rehearsal_units


class ReleaseRehearsalTest(unittest.TestCase):
    def test_rehearsal_preserves_release_commands_and_rpc_method_gates(self) -> None:
        for files in release_rehearsal_units():
            with self.subTest(files=files):
                normal = rendered_compose_config(files[:-1])["services"]
                fixture = rendered_compose_config(files)["services"]
                for name, service in normal.items():
                    if "command" in service:
                        self.assertEqual(service["command"], fixture[name]["command"])
                    if "environment" in service and "RPC_ALLOWED_METHODS" in service["environment"]:
                        self.assertEqual(service["environment"]["RPC_ALLOWED_METHODS"], fixture[name]["environment"]["RPC_ALLOWED_METHODS"])
                    if name in ("release-plan", "verify-input"):
                        self.assertEqual("0", service["environment"]["RELEASE_REHEARSAL"])
                        self.assertEqual("1", fixture[name]["environment"]["RELEASE_REHEARSAL"])

    def test_owner_only_rpc_files_use_the_creating_users_identity(self) -> None:
        infrastructure = rendered_compose_config("compose/release/rehearsal.yml")["services"]
        file_owner = infrastructure["rehearsal-prepare"]["user"]
        for name, files in makefile_compose_units().items():
            if name.endswith(("_RELEASE_DEPLOY_COMPOSE_FILES", "_RELEASE_VERIFY_COMPOSE_FILES")):
                services = rendered_compose_config(files)["services"]
                for service_name in ("release-rpc-proxy", "release-artifact-rpc-proxy", "verify-rpc-proxy"):
                    if service_name in services:
                        self.assertEqual(file_owner, services[service_name]["user"])

    def test_fixture_has_no_public_network_or_source_write_authority(self) -> None:
        infrastructure = rendered_compose_config("compose/release/rehearsal.yml")
        for network in infrastructure["networks"].values():
            self.assertIs(network["internal"], True)
        for service in infrastructure["services"].values():
            self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            self.assertIs(service["read_only"], True)
        prepare = compose_service(infrastructure, "rehearsal-prepare")
        writable = [
            volume["target"] for volume in prepare["volumes"]
            if volume.get("type") == "bind" and volume.get("read_only") is not True
        ]
        self.assertEqual(["/rehearsal-control"], writable)
        accept = compose_service(infrastructure, "rehearsal-accept")
        for volume in accept["volumes"]:
            self.assertIs(volume["read_only"], True)

    def test_fixture_network_replaces_only_the_public_upstream_network(self) -> None:
        for files in release_rehearsal_units():
            config = rendered_compose_config(files)
            for name, service in config["services"].items():
                if name.endswith("rpc-proxy"):
                    self.assertEqual(["python3", "/rehearsal/rpc_proxy.py"], service["entrypoint"])
                self.assertEqual([], compose_sequence_or_empty(service, "ports"))
            for name, network in compose_mapping(config, "networks").items():
                if name.endswith("_egress"):
                    self.assertIs(network["external"], True)
                    self.assertEqual("cam-release-rehearsal-fixture", network["name"])
                else:
                    self.assertIs(network["internal"], True)
