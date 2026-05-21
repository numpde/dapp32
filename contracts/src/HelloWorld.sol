pragma solidity 0.8.35;

contract HelloWorld {
    error EmptyMessage();
    error Unauthorized(address caller);

    event MessageChanged(address indexed caller, string oldMessage, string newMessage);

    address private immutable OWNER;
    string private currentMessage;

    constructor(string memory initialMessage) {
        if (bytes(initialMessage).length == 0) {
            revert EmptyMessage();
        }

        OWNER = msg.sender;
        currentMessage = initialMessage;
    }

    function owner() external view returns (address) {
        return OWNER;
    }

    function message() external view returns (string memory) {
        return currentMessage;
    }

    function setMessage(string calldata newMessage) external {
        if (msg.sender != OWNER) {
            revert Unauthorized(msg.sender);
        }

        if (bytes(newMessage).length == 0) {
            revert EmptyMessage();
        }

        string memory oldMessage = currentMessage;
        currentMessage = newMessage;

        emit MessageChanged(msg.sender, oldMessage, newMessage);
    }
}
