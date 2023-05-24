// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/ERC2771Recipient.sol";


contract CaptureThatFlag is ERC2771Recipient {
    address public capturedBy;

    constructor(){

    }

    function setTrustedForwarder(address forwarder) public {
        _setTrustedForwarder(forwarder);
    }

    function reset() public {
        capturedBy = address(0);
    }

    function captureTheFlag() public {
        capturedBy = _msgSender();
    }
}
