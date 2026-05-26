from __future__ import annotations

import unittest

from .cam_route_abi import AbiRouteFunction
from .cam_route_abi import abi_route_functions
from .cam_route_abi import validate_route_function_mutability
from .cam_route_abi import validate_route_output_shape
from .cam_route_abi import validate_screen_values_references
from .common import repo_path


class CamRouteAbiTest(unittest.TestCase):
    def test_cam_route_abi_checker_self_check(self) -> None:
        manifest = repo_path("dapps/example/cam/main.json")

        self.assertEqual(
            abi_route_functions(
                [
                    {
                        "type": "function",
                        "name": "viewEntry",
                        "stateMutability": "view",
                        "inputs": [{"type": "address"}],
                    },
                    {"type": "event", "name": "Ignored", "inputs": []},
                    {"type": "function", "name": "overloaded", "stateMutability": "view", "inputs": []},
                    {
                        "type": "function",
                        "name": "overloaded",
                        "stateMutability": "view",
                        "inputs": [{"type": "string"}],
                    },
                ]
            ),
            {
                "viewEntry": AbiRouteFunction(input_count=1, state_mutability="view", outputs=()),
                "overloaded": None,
            },
        )

        self.assertEqual(
            validate_route_output_shape(
                manifest,
                "routes.entry",
                "Example",
                "viewEntry",
                AbiRouteFunction(
                    input_count=1,
                    state_mutability="view",
                    outputs=({"name": "screenURI", "type": "string"},),
                ),
            ),
            [],
        )
        self.assertEqual(
            validate_route_function_mutability(
                manifest,
                "routes.entry",
                "Example",
                "viewEntry",
                AbiRouteFunction(
                    input_count=1,
                    state_mutability="nonpayable",
                    outputs=({"name": "screenURI", "type": "string"},),
                ),
            ),
            [f"{manifest}: routes.entry.function must be view or pure in Example ABI: viewEntry"],
        )

        bad_first_outputs = [
            ("MissingOutputs", None),
            ("WrongName", {"name": "uri", "type": "string"}),
            ("WrongType", {"name": "screenURI", "type": "bytes32"}),
            ("MalformedOutput", "screenURI"),
        ]
        for case_name, first_output in bad_first_outputs:
            with self.subTest(case_name=case_name):
                self.assertTrue(
                    validate_route_output_shape(
                        manifest,
                        "routes.entry",
                        "Example",
                        "viewEntry",
                        AbiRouteFunction(
                            input_count=1,
                            state_mutability="view",
                            outputs=() if first_output is None else (first_output,),
                        ),
                    )
                )

        route_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.exists"},
                {"type": "status", "value": "$values.1"},
            ],
        }
        route_function = AbiRouteFunction(
            input_count=0,
            state_mutability="view",
            outputs=(
                {"name": "screenURI", "type": "string"},
                {
                    "name": "component",
                    "type": "tuple",
                    "components": [{"name": "exists", "type": "bool"}],
                },
                {"name": "count", "type": "uint256"},
            ),
        )
        self.assertEqual(
            validate_screen_values_references(
                manifest,
                "routes.entry",
                manifest.parent / "screens" / "entry.json",
                route_screen,
                "Example",
                "viewEntry",
                route_function,
            ),
            [],
        )

        bad_screen = {
            "screen": "1.0.0",
            "elements": [
                {"type": "status", "value": "$values.0.missing"},
                {"type": "status", "value": "$values.1.count"},
                {"type": "status", "value": "$values.2"},
            ],
        }
        failures = validate_screen_values_references(
            manifest,
            "routes.entry",
            manifest.parent / "screens" / "entry.json",
            bad_screen,
            "Example",
            "viewEntry",
            route_function,
        )
        self.assertEqual(len(failures), 3)
