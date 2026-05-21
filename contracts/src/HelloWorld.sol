pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.4.0/access/Ownable.sol";

/// @dev Minimal example contract that uses OpenZeppelin for ownership instead
/// of hand-rolling access control. The owner may update the message, but this
/// example keeps ownership fixed after deployment.
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

    /// @dev `onlyOwner` comes from OpenZeppelin Ownable and centralizes the
    /// authorization check.
    function setMessage(string calldata newMessage) external onlyOwner {
        if (bytes(newMessage).length == 0) {
            revert EmptyMessage();
        }

        string memory oldMessage = currentMessage;
        currentMessage = newMessage;

        emit MessageChanged(msg.sender, oldMessage, newMessage);
    }

    /// @dev OpenZeppelin Ownable normally allows the owner to renounce
    /// ownership. This example disables that path so the owner invariant stays
    /// simple: the deployment owner remains the owner forever.
    function renounceOwnership() public view override onlyOwner {
        revert FixedOwner();
    }

    /// @dev OpenZeppelin Ownable normally allows transferring ownership. This
    /// example disables transfers for the same reason it disables renounce:
    /// fixed ownership keeps the HelloWorld behavior intentionally small.
    function transferOwnership(address) public view override onlyOwner {
        revert FixedOwner();
    }
}
