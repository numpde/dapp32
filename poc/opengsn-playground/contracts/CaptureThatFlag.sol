// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/ERC2771Recipient.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract CaptureThatFlag is ERC2771Recipient, Ownable {
    address public capturedBy;

    constructor(){

    }

    function setTrustedForwarder(address forwarder) public onlyOwner {
        _setTrustedForwarder(forwarder);
    }

    function captureTheFlag() public {
        capturedBy = _msgSender();
    }

    function _msgSender() internal override(ERC2771Recipient, Context) view returns (address sender) {
        return ERC2771Recipient._msgSender();
    }

    function _msgData() internal override(ERC2771Recipient, Context) view returns (bytes calldata) {
        return ERC2771Recipient._msgData();
    }
}
