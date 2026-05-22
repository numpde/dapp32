pragma solidity 0.8.35;

import {HelloWorld} from "../../../src/HelloWorld.sol";

contract HelloWorldFuzzTest {
    function testFuzzOwnerCanSetAnyNonEmptyMessage(string calldata newMessage) external {
        if (bytes(newMessage).length == 0) {
            return;
        }

        HelloWorld hello = new HelloWorld("hello");

        hello.setMessage(newMessage);

        assertStringEq(hello.message(), newMessage);
    }

    function assertStringEq(string memory actual, string memory expected) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) {
            revert("string mismatch");
        }
    }
}
