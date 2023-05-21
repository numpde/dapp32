// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.18;

contract AppUI {
    function baseURI() public pure returns (string memory) {
        return "http://0.0.0.0:8000/poc/on-chain/contracts/AppUI/";
    }

    function getInitialView() public pure returns (string memory) {
        return string(abi.encodePacked(baseURI(), "getInitialView", ".json"));
    }
}
