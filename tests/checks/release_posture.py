from __future__ import annotations

import os
import subprocess
import unittest
from typing import Any

from .common import (
    ROOT,
    compose_mapping,
    compose_sequence_or_empty,
    compose_volume,
)


# silent-defaults: allow-default -- Most recipe inspections need no Make overrides.
def expanded_release_target(target: str, overrides: tuple[str, ...] = ()) -> str:
    """Inspect the supported release recipe after Make expands its shared owners."""
    env = {key: value for key, value in os.environ.items() if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS")}
    return subprocess.run(
        ["make", "--no-print-directory", "--dry-run", "-f", str(ROOT / "Makefile"), target, *overrides],
        cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=10,
    ).stdout


def _environment(service: dict[str, Any]) -> dict[str, Any]:
    if "environment" not in service:
        return {}
    value = service["environment"]
    if not isinstance(value, dict):
        raise AssertionError("environment must render as a mapping")
    return value


def _rpc_methods(service: dict[str, Any]) -> set[str]:
    environment = _environment(service)
    if "RPC_ALLOWED_METHODS" not in environment:
        return set()
    methods = environment["RPC_ALLOWED_METHODS"]
    if not isinstance(methods, str):
        raise AssertionError("RPC_ALLOWED_METHODS must render as a string")
    return set(methods.split())


def _source_access_modes(service: dict[str, Any], source: str) -> list[bool]:
    return [
        "read_only" in volume and volume["read_only"] is True
        for volume in compose_sequence_or_empty(service, "volumes")
        if volume.get("source") == source
    ]


def assert_offline_read_only_release_check(
    case: unittest.TestCase,
    service: dict[str, Any],
) -> None:
    case.assertEqual("none", service["network_mode"])
    case.assertIs(service["read_only"], True)
    case.assertIn("ALL", compose_sequence_or_empty(service, "cap_drop"))


def assert_deployment_authority_split(
    case: unittest.TestCase,
    config: dict[str, Any],
    *,
    operation: str,
    planner_name: str,
    signer_name: str,
    materializer_name: str,
    signing_proxy_name: str,
    materializer_proxy_name: str,
) -> None:
    services = compose_mapping(config, "services")
    planner = services[planner_name]
    signer = services[signer_name]
    materializer = services[materializer_name]
    signing_proxy = services[signing_proxy_name]
    materializer_proxy = services[materializer_proxy_name]
    approval = services["release-approval"]
    reference_export = services["release-reference-export"]
    reference_prepare = services["release-reference-prepare"]

    case.assertIn(operation, ("contracts", "ui", "cam"))
    if operation == "contracts":
        case.assertEqual("none", planner["network_mode"])
    else:
        case.assertNotIn("network_mode", planner)
        case.assertEqual({"release_artifact_internal"}, set(compose_mapping(planner, "networks")))
    for reference_service in (reference_export, reference_prepare):
        if operation == "cam" and reference_service is reference_prepare:
            case.assertNotIn("network_mode", reference_service)
            case.assertEqual({"release_artifact_internal"}, set(compose_mapping(reference_service, "networks")))
        else:
            case.assertEqual("none", reference_service["network_mode"])
        case.assertEqual([], compose_sequence_or_empty(reference_service, "secrets"))
        case.assertEqual([], compose_sequence_or_empty(reference_service, "ports"))
        case.assertIs(reference_service["read_only"], True)
    case.assertEqual("service_completed_successfully", reference_prepare["depends_on"]["release-reference-export"]["condition"])
    case.assertIs(compose_volume(reference_export, "/work/dapps")["read_only"], True)
    case.assertIs(compose_volume(reference_prepare, "/work/dapps")["read_only"], True)
    if operation == "cam":
        case.assertIsNot(compose_volume(reference_prepare, "/release-plan").get("read_only"), True)
    else:
        case.assertIs(compose_volume(reference_prepare, "/release-plan")["read_only"], True)
    case.assertIs(compose_volume(reference_prepare, "/reference-artifacts")["read_only"], True)
    case.assertIsNot(compose_volume(reference_prepare, "/reference-out").get("read_only"), True)
    case.assertNotIn("depends_on", materializer_proxy)
    if operation == "cam":
        case.assertNotIn("depends_on", signing_proxy)
        case.assertEqual("service_healthy", reference_prepare["depends_on"][materializer_proxy_name]["condition"])
    else:
        case.assertEqual("service_completed_successfully", signing_proxy["depends_on"][planner_name]["condition"])
    case.assertEqual("service_healthy", materializer["depends_on"][materializer_proxy_name]["condition"])
    case.assertEqual([], compose_sequence_or_empty(planner, "secrets"))
    case.assertEqual([], compose_sequence_or_empty(planner, "ports"))
    case.assertEqual(1, float(planner["cpus"]))
    case.assertEqual(planner["mem_limit"], planner["memswap_limit"])
    case.assertIn(planner["ulimits"]["core"], ({}, {"hard": 0, "soft": 0}))
    case.assertTrue(planner["init"])
    for target in ("/input/js", "/work/js/node_modules"):
        case.assertIs(compose_volume(planner, target)["read_only"], True)
    if operation == "contracts":
        case.assertNotIn("/work/dapps", [mount["target"] for mount in compose_sequence_or_empty(planner, "volumes")])
    elif operation == "ui":
        case.assertIs(compose_volume(planner, "/backing/deployment.json")["read_only"], True)
    else:
        for target in ("/work/dapps", "/prepared", "/root-proof"):
            case.assertIs(compose_volume(planner, target)["read_only"], True)
        root_source = services["release-cam-root-source"]
        assert_offline_read_only_release_check(case, root_source)
        selected_root = compose_volume(root_source, "/selected/root.json")
        case.assertIs(selected_root["read_only"], True)
        root_proof = compose_volume(root_source, "/root-proof")
        case.assertIsNot(root_proof.get("read_only"), True)
        for consumer in (planner, materializer):
            proof_read = compose_volume(consumer, "/root-proof")
            case.assertEqual(root_proof["source"], proof_read["source"])
            case.assertIs(proof_read["read_only"], True)
            case.assertEqual([], _source_access_modes(consumer, selected_root["source"]))
        approval_audit = compose_volume(approval, "/run/audit")
        audit_read = compose_volume(materializer, "/approval-audit")
        case.assertEqual(approval_audit["source"], audit_read["source"])
        case.assertIs(audit_read["read_only"], True)
    key_holders = [
        name
        for name, service in services.items()
        if any(
            secret.get("source") == "deployer_private_key"
            or secret.get("target") == "deployer_private_key"
            for secret in compose_sequence_or_empty(service, "secrets")
        )
    ]
    case.assertEqual([signer_name], key_holders)
    signer_key_secrets = [
        secret
        for secret in compose_sequence_or_empty(signer, "secrets")
        if secret.get("source") == "deployer_private_key"
        or secret.get("target") == "deployer_private_key"
    ]
    case.assertEqual(
        [{"source": "deployer_private_key", "target": "deployer_private_key"}],
        signer_key_secrets,
    )
    case.assertNotIn("PRIVATE_KEY", _environment(signer))
    case.assertTrue(signer["init"])
    case.assertEqual(1, float(signer["cpus"]))
    case.assertEqual(signer["mem_limit"], signer["memswap_limit"])
    case.assertIn(signer["ulimits"]["core"], ({}, {"hard": 0, "soft": 0}))

    send_capable_services = [
        name
        for name, service in services.items()
        if "eth_sendRawTransaction" in _rpc_methods(service)
    ]
    case.assertEqual([signing_proxy_name], send_capable_services)
    case.assertNotIn("eth_sendRawTransaction", _rpc_methods(materializer_proxy))

    case.assertEqual("none", signer["network_mode"])
    case.assertNotIn("networks", signer)
    case.assertIn("--rpc-url file:///run/approval/rpc.sock", " ".join(signer["command"]))
    signer_socket = compose_volume(signer, "/run/approval")
    approval_socket = compose_volume(approval, "/run/approval")
    case.assertEqual(signer_socket["source"], approval_socket["source"])
    case.assertIs(signer_socket["read_only"], True)
    case.assertIsNot(approval_socket.get("read_only"), True)
    case.assertIs(compose_volume(approval, "/run/reference/reference.json")["read_only"], True)
    case.assertIsNot(compose_volume(approval, "/run/audit").get("read_only"), True)
    case.assertEqual([], compose_sequence_or_empty(approval, "secrets"))
    case.assertEqual([], compose_sequence_or_empty(approval, "ports"))
    case.assertIs(approval["read_only"], True)
    case.assertEqual("service_healthy", signer["depends_on"]["release-approval"]["condition"])
    case.assertNotIn("build", approval)
    case.assertEqual("never", approval["pull_policy"])
    case.assertRegex(approval["image"], r"^sha256:[0-9a-f]{64}$")
    case.assertEqual(1, len(compose_mapping(approval, "networks")))
    case.assertNotIn("release_deploy_egress", approval["networks"])
    case.assertNotIn("release_artifact_internal", approval["networks"])
    case.assertNotIn("release_artifact_egress", approval["networks"])
    approval_volumes = compose_sequence_or_empty(approval, "volumes")
    case.assertEqual([], [volume for volume in approval_volumes if volume["target"].startswith(("/work", "/run/secrets"))])
    signer_source = compose_volume(signer, "/work/dapps")["source"]
    case.assertEqual([], [volume for volume in approval_volumes if volume["source"] == signer_source])
    materializer_networks = set(compose_mapping(materializer, "networks"))
    approval_networks = set(compose_mapping(approval, "networks"))
    for network in approval_networks:
        case.assertTrue(config["networks"][network]["internal"])
        members = {
            name for name, service in services.items()
            if "networks" in service and network in compose_mapping(service, "networks")
        }
        case.assertEqual({"release-approval", signing_proxy_name}, members)
    case.assertTrue(materializer_networks)
    case.assertTrue(approval_networks.isdisjoint(materializer_networks))
    case.assertTrue(approval_networks.issubset(compose_mapping(signing_proxy, "networks")))
    case.assertTrue(
        materializer_networks.issubset(compose_mapping(materializer_proxy, "networks"))
    )


def assert_release_output_directions(
    case: unittest.TestCase,
    *,
    operation: str,
    planner: dict[str, Any],
    signer: dict[str, Any],
    materializer: dict[str, Any],
    publisher: dict[str, Any],
    plan_target: str,
    broadcast_target: str,
    candidate_target: str,
    artifact_target: str,
) -> None:
    case.assertIn(operation, ("contracts", "ui", "cam"))
    plan_write = compose_volume(planner, plan_target)
    signer_plan = compose_volume(signer, plan_target)
    materializer_plan = compose_volume(materializer, plan_target)
    publisher_plan = compose_volume(publisher, plan_target)
    signer_broadcast = compose_volume(signer, broadcast_target)
    candidate_write = compose_volume(materializer, candidate_target)
    publisher_candidate = compose_volume(publisher, candidate_target)
    artifact_write = compose_volume(publisher, artifact_target)

    case.assertIsNot(plan_write.get("read_only"), True)
    for volume in (signer_plan, materializer_plan, publisher_plan):
        case.assertEqual(plan_write["source"], volume["source"])
        case.assertIs(volume["read_only"], True)
    case.assertEqual([False], _source_access_modes(planner, plan_write["source"]))
    for service in (signer, materializer, publisher):
        case.assertEqual([True], _source_access_modes(service, plan_write["source"]))

    case.assertIsNot(signer_broadcast.get("read_only"), True)
    case.assertEqual([], _source_access_modes(planner, signer_broadcast["source"]))
    case.assertEqual([False], _source_access_modes(signer, signer_broadcast["source"]))
    if operation == "cam":
        case.assertEqual([], _source_access_modes(materializer, signer_broadcast["source"]))
        audit_read = compose_volume(materializer, "/approval-audit")
        case.assertIs(audit_read["read_only"], True)
    else:
        materializer_broadcast = compose_volume(materializer, broadcast_target)
        case.assertEqual(signer_broadcast["source"], materializer_broadcast["source"])
        case.assertIs(materializer_broadcast["read_only"], True)
        case.assertEqual([True], _source_access_modes(materializer, signer_broadcast["source"]))
    case.assertEqual([], _source_access_modes(publisher, signer_broadcast["source"]))

    case.assertIsNot(candidate_write.get("read_only"), True)
    case.assertEqual(candidate_write["source"], publisher_candidate["source"])
    case.assertIs(publisher_candidate["read_only"], True)
    case.assertEqual([False], _source_access_modes(materializer, candidate_write["source"]))
    case.assertEqual([True], _source_access_modes(publisher, candidate_write["source"]))
    for service in (planner, signer):
        case.assertEqual([], _source_access_modes(service, candidate_write["source"]))
        case.assertEqual([], _source_access_modes(service, artifact_write["source"]))

    case.assertIsNot(artifact_write.get("read_only"), True)
    case.assertEqual([False], _source_access_modes(publisher, artifact_write["source"]))
    if operation == "ui":
        case.assertEqual([], _source_access_modes(materializer, artifact_write["source"]))
    else:
        artifact_read = compose_volume(materializer, artifact_target)
        case.assertEqual(artifact_write["source"], artifact_read["source"])
        case.assertIs(artifact_read["read_only"], True)
        case.assertEqual([True], _source_access_modes(materializer, artifact_write["source"]))
    assert_offline_read_only_release_check(case, publisher)
    for target in ("/input/js", "/work/js/node_modules"):
        case.assertIs(compose_volume(publisher, target)["read_only"], True)
    assert_verification_has_no_signing_authority(case, {"publisher": publisher})


def assert_verification_has_no_signing_authority(
    case: unittest.TestCase,
    services: dict[str, Any],
) -> None:
    for service in services.values():
        case.assertNotIn("PRIVATE_KEY", _environment(service))
        case.assertNotIn("eth_sendRawTransaction", _rpc_methods(service))
        case.assertEqual(
            [],
            [
                secret
                for secret in compose_sequence_or_empty(service, "secrets")
                if secret.get("source") == "deployer_private_key"
                or secret.get("target") == "deployer_private_key"
            ],
        )
        if "command" in service and service["command"] is not None:
            command_items = service["command"]
            if not isinstance(command_items, list):
                raise AssertionError("command must render as a list or null")
            command = " ".join(str(item) for item in command_items)
            case.assertNotIn("--broadcast", command)
