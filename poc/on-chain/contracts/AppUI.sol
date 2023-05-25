// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/ERC2771Recipient.sol";


contract AppUI is ERC2771Recipient {
    event Submit(address indexed userAddress, address indexed sender, address indexed origin);

    function _baseURI() private pure returns (string memory) {
        return "http://0.0.0.0:8540/poc/on-chain/contracts/AppUI/";
    }

    function setTrustedForwarder(address forwarder) public {
        _setTrustedForwarder(forwarder);
    }

    function abiURI() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "../../../artifacts/contracts/AppUI.sol/AppUI", ".json"));
    }

    function getInitialView() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "getInitialViewOutput", ".json"));
    }

    function getSecondView(address userAddress, string memory userName, string memory favoriteColor) public pure returns (string memory) {
        (userAddress, userName, favoriteColor);
        return string(abi.encodePacked(_baseURI(), "getSecondViewOutput", ".json"));
    }

    function submit(address userAddress) public {
        emit Submit(userAddress, _msgSender(), msg.sender);
    }

    function onSuccess() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "onSuccessOutput", ".json"));
    }

    function onFailure() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "onFailureOutput", ".json"));
    }
}
