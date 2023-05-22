// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

contract AppUI {
    function _baseURI() private pure returns (string memory) {
        return "http://0.0.0.0:8000/poc/on-chain/contracts/AppUI/";
    }

    function abiURI() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "../../../artifacts/contracts/AppUI.sol/AppUI", ".json"));
    }

    function getInitialView() public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "getInitialView", ".json"));
    }

    function getSecondView(address userAddress, string memory userName, string memory favoriteColor) public pure returns (string memory) {
        return string(abi.encodePacked(_baseURI(), "getSecondView", ".json"));
    }
}
