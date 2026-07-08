pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

/// @dev Shared test vocabulary for BicycleComponentManagerUI.
/// These IDs are contract-returned protocol values, so manager unit and
/// scenario tests should assert the same spelling and action ordering from one
/// place. The production contract keeps the strings private to avoid expanding
/// its ABI just for tests.
abstract contract BicycleComponentManagerTestSupport is Test {
    string internal constant VIEW_ENTRY = "entry";
    string internal constant VIEW_COMPONENT_EMPTY = "component.empty";
    string internal constant VIEW_COMPONENT_ACTIVE = "component.active";
    string internal constant VIEW_COMPONENT_MISSING = "component.missing";
    string internal constant VIEW_COMPONENT_RETIRED = "component.retired";
    string internal constant VIEW_COMPONENT_NOT_FOUND = "component.notFound";
    string internal constant VIEW_REGISTER_EMPTY = "register.empty";
    string internal constant VIEW_REGISTER_READY = "register.ready";
    string internal constant VIEW_REGISTER_BLOCKED = "register.blocked";

    string internal constant ACTION_LOOKUP_COMPONENT = "lookupComponent";
    string internal constant ACTION_OPEN_REGISTER = "openRegister";
    string internal constant ACTION_REGISTER_COMPONENT = "registerComponent";
    string internal constant ACTION_UPDATE_COMPONENT_METADATA = "updateComponentMetadata";
    string internal constant ACTION_MARK_COMPONENT_MISSING = "markComponentMissing";
    string internal constant ACTION_CLEAR_COMPONENT_MISSING = "clearComponentMissing";
    string internal constant ACTION_RETIRE_COMPONENT = "retireComponent";

    /// @dev Action arrays are ordered protocol data: the UI manifest renders
    /// buttons in this order, so these assertions intentionally check both set
    /// membership and ordering.
    function assertActions(string[] memory actual, string[] memory expected) internal pure {
        assertEq(actual.length, expected.length, "action count mismatch");

        for (uint256 index; index < expected.length; index++) {
            assertEq(actual[index], expected[index], "action mismatch");
        }
    }

    /// @dev The remaining helpers name recurring UI capability states. Tests
    /// that use them are checking a semantic state, not rebuilding an arbitrary
    /// string array inline.
    function assertLookupOnly(string[] memory actual) internal pure {
        assertActions(actual, expectedActions(ACTION_LOOKUP_COMPONENT));
    }

    function assertLookupAndRegisterActions(string[] memory actual) internal pure {
        assertActions(actual, expectedActions(ACTION_LOOKUP_COMPONENT, ACTION_OPEN_REGISTER));
    }

    function assertRegisterReadyActions(string[] memory actual) internal pure {
        assertActions(actual, expectedActions(ACTION_REGISTER_COMPONENT, ACTION_LOOKUP_COMPONENT));
    }

    function assertActiveOwnerActions(string[] memory actual) internal pure {
        assertActions(
            actual,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_MARK_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );
    }

    function assertMissingOwnerActions(string[] memory actual) internal pure {
        assertActions(
            actual,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_CLEAR_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );
    }

    /// @dev Kept as small overloads instead of a variadic-like helper because
    /// Solidity has no native variadic function parameters, and the explicit
    /// arity keeps custom action expectations readable at call sites.
    function expectedActions(string memory first) internal pure returns (string[] memory actions) {
        actions = new string[](1);
        actions[0] = first;
    }

    function expectedActions(string memory first, string memory second)
        internal
        pure
        returns (string[] memory actions)
    {
        actions = new string[](2);
        actions[0] = first;
        actions[1] = second;
    }

    function expectedActions(string memory first, string memory second, string memory third)
        internal
        pure
        returns (string[] memory actions)
    {
        actions = new string[](3);
        actions[0] = first;
        actions[1] = second;
        actions[2] = third;
    }

    function expectedActions(string memory first, string memory second, string memory third, string memory fourth)
        internal
        pure
        returns (string[] memory actions)
    {
        actions = new string[](4);
        actions[0] = first;
        actions[1] = second;
        actions[2] = third;
        actions[3] = fourth;
    }
}
