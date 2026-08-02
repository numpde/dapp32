from __future__ import annotations

from typing import Any
import unittest

from .common import (
    compose_mapping,
    compose_sequence_or_empty,
    compose_volume,
)


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
    services: dict[str, Any],
    *,
    planner_name: str,
    signer_name: str,
    materializer_name: str,
    signing_proxy_name: str,
    materializer_proxy_name: str,
) -> None:
    planner = services[planner_name]
    signer = services[signer_name]
    materializer = services[materializer_name]
    signing_proxy = services[signing_proxy_name]
    materializer_proxy = services[materializer_proxy_name]

    case.assertEqual("none", planner["network_mode"])
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

    send_capable_services = [
        name
        for name, service in services.items()
        if "eth_sendRawTransaction" in _rpc_methods(service)
    ]
    case.assertEqual([signing_proxy_name], send_capable_services)
    case.assertNotIn("eth_sendRawTransaction", _rpc_methods(materializer_proxy))

    signer_networks = set(compose_mapping(signer, "networks"))
    materializer_networks = set(compose_mapping(materializer, "networks"))
    case.assertTrue(signer_networks)
    case.assertTrue(materializer_networks)
    case.assertTrue(signer_networks.isdisjoint(materializer_networks))
    case.assertTrue(signer_networks.issubset(compose_mapping(signing_proxy, "networks")))
    case.assertTrue(
        materializer_networks.issubset(compose_mapping(materializer_proxy, "networks"))
    )


def assert_release_output_directions(
    case: unittest.TestCase,
    *,
    planner: dict[str, Any],
    signer: dict[str, Any],
    materializer: dict[str, Any],
    plan_target: str,
    broadcast_target: str,
    artifact_target: str,
) -> None:
    plan_write = compose_volume(planner, plan_target)
    signer_plan = compose_volume(signer, plan_target)
    materializer_plan = compose_volume(materializer, plan_target)
    signer_broadcast = compose_volume(signer, broadcast_target)
    materializer_broadcast = compose_volume(materializer, broadcast_target)
    materializer_artifact = compose_volume(materializer, artifact_target)

    case.assertIsNot(plan_write.get("read_only"), True)
    for volume in (signer_plan, materializer_plan):
        case.assertEqual(plan_write["source"], volume["source"])
        case.assertIs(volume["read_only"], True)
    case.assertIsNot(signer_broadcast.get("read_only"), True)
    case.assertEqual(signer_broadcast["source"], materializer_broadcast["source"])
    case.assertIs(materializer_broadcast["read_only"], True)
    case.assertIsNot(materializer_artifact.get("read_only"), True)
    case.assertEqual([False], _source_access_modes(planner, plan_write["source"]))
    case.assertEqual([True], _source_access_modes(signer, plan_write["source"]))
    case.assertEqual([True], _source_access_modes(materializer, plan_write["source"]))
    case.assertEqual([], _source_access_modes(planner, signer_broadcast["source"]))
    case.assertEqual([False], _source_access_modes(signer, signer_broadcast["source"]))
    case.assertEqual(
        [True],
        _source_access_modes(materializer, signer_broadcast["source"]),
    )
    case.assertEqual([], _source_access_modes(planner, materializer_artifact["source"]))
    case.assertEqual([], _source_access_modes(signer, materializer_artifact["source"]))
    case.assertEqual(
        [False],
        _source_access_modes(materializer, materializer_artifact["source"]),
    )


def assert_receipt_gated_verification(
    case: unittest.TestCase,
    *,
    input_service: dict[str, Any],
    input_service_name: str,
    provenance_service: dict[str, Any],
    provenance_service_name: str,
    verifier_service: dict[str, Any],
) -> None:
    case.assertEqual("none", input_service["network_mode"])
    case.assertEqual(
        "service_completed_successfully",
        provenance_service["depends_on"][input_service_name]["condition"],
    )
    case.assertEqual(
        "service_completed_successfully",
        verifier_service["depends_on"][provenance_service_name]["condition"],
    )


def assert_verification_snapshot_boundary(
    case: unittest.TestCase,
    *,
    input_service: dict[str, Any],
    downstream_services: tuple[dict[str, Any], ...],
    external_artifact_target: str,
    snapshot_target: str,
) -> None:
    external_artifact = compose_volume(input_service, external_artifact_target)
    case.assertEqual("bind", external_artifact["type"])
    case.assertIs(external_artifact["read_only"], True)
    for service in downstream_services:
        case.assertEqual(
            [],
            [
                volume
                for volume in compose_sequence_or_empty(service, "volumes")
                if volume.get("type") == "bind"
                and (
                    volume.get("source") == external_artifact["source"]
                    or volume.get("target") == external_artifact_target
                )
            ],
        )

    snapshot_write = compose_volume(input_service, snapshot_target)
    case.assertIsNot(snapshot_write.get("read_only"), True)
    case.assertEqual({}, snapshot_write["volume"])
    for service in downstream_services:
        snapshot_read = compose_volume(service, snapshot_target)
        case.assertEqual(snapshot_write["source"], snapshot_read["source"])
        case.assertIs(snapshot_read["read_only"], True)
        case.assertEqual({"nocopy": True}, snapshot_read["volume"])


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
