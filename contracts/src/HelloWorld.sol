pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.4.0/access/Ownable.sol";

contract HelloWorld is Ownable {
    error EmptyMessage();
    error FixedOwner();

    event MessageChanged(address indexed caller, string oldMessage, string newMessage);

    string private currentMessage;

    constructor(string memory initialMessage) Ownable(msg.sender) {
        if (bytes(initialMessage).length == 0) {
            revert EmptyMessage();
        }

        currentMessage = initialMessage;
    }

    function message() external view returns (string memory) {
        return currentMessage;
    }

    function setMessage(string calldata newMessage) external onlyOwner {
        if (bytes(newMessage).length == 0) {
            revert EmptyMessage();
        }

        string memory oldMessage = currentMessage;
        currentMessage = newMessage;

        emit MessageChanged(msg.sender, oldMessage, newMessage);
    }

    function renounceOwnership() public view override onlyOwner {
        revert FixedOwner();
    }

    function transferOwnership(address) public view override onlyOwner {
        revert FixedOwner();
    }
}
