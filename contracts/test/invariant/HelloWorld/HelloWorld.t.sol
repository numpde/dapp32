pragma solidity 0.8.35;

import {HelloWorld} from "../../../src/HelloWorld.sol";

contract HelloWorldInvariantTest {
    HelloWorld private hello;
    address private initialOwner;

    function setUp() external {
        hello = new HelloWorld("hello");
        initialOwner = hello.owner();
    }

    function invariantOwnerNeverChanges() external view {
        if (hello.owner() != initialOwner) {
            revert("owner changed");
        }
    }
}
