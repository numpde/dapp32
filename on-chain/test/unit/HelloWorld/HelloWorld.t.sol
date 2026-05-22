pragma solidity 0.8.35;

import {HelloWorld} from "../../../src/HelloWorld.sol";

contract HelloWorldCaller {
    function setMessage(HelloWorld target, string calldata newMessage) external {
        target.setMessage(newMessage);
    }
}

contract HelloWorldTest {
    function testInitialMessage() external {
        HelloWorld hello = new HelloWorld("hello");

        assertStringEq(hello.message(), "hello");
        assertEq(hello.owner(), address(this));
    }

    function testOwnerCanChangeMessage() external {
        HelloWorld hello = new HelloWorld("hello");

        hello.setMessage("gm");

        assertStringEq(hello.message(), "gm");
    }

    function testRejectsEmptyInitialMessage() external {
        try new HelloWorld("") returns (HelloWorld) {
            revert("expected empty initial message to revert");
        } catch (bytes memory) {
            return;
        }
    }

    function testRejectsEmptyUpdatedMessage() external {
        HelloWorld hello = new HelloWorld("hello");

        try hello.setMessage("") {
            revert("expected empty updated message to revert");
        } catch (bytes memory) {
            return;
        }
    }

    function testRejectsNonOwnerUpdate() external {
        HelloWorld hello = new HelloWorld("hello");
        HelloWorldCaller caller = new HelloWorldCaller();

        try caller.setMessage(hello, "not owner") {
            revert("expected non-owner update to revert");
        } catch (bytes memory) {
            return;
        }
    }

    function assertEq(address actual, address expected) internal pure {
        if (actual != expected) {
            revert("address mismatch");
        }
    }

    function assertStringEq(string memory actual, string memory expected) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) {
            revert("string mismatch");
        }
    }
}
