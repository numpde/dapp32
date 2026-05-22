// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";


library Utils {
    function stringifyOnChainMetadata(string memory spacer, string memory name, string memory description, string memory imageURL, string[] memory traitTypes, string[] memory traitValues)
    internal pure returns (string memory)
    {
        string memory jsonBody = string(
            abi.encodePacked(
                '{',
                '"name":"', name, '",', spacer,
                '"description":"', description, '",', spacer,
                '"image":"', imageURL, '"'
            )
        );

        require(traitTypes.length == traitValues.length, "Type/Value arrays must have the same length");

        if (traitTypes.length > 0) {
            jsonBody = string(abi.encodePacked(jsonBody, ',', spacer, '"attributes":['));

            for (uint i = 0; i < traitTypes.length; i++) {
                if (i > 0) {
                    jsonBody = string(abi.encodePacked(jsonBody, ','));
                }

                jsonBody = string(abi.encodePacked(jsonBody, '{"trait_type":"', traitTypes[i], '",', spacer, '"value":"', traitValues[i], '"}'));
            }

            jsonBody = string(abi.encodePacked(jsonBody, ']'));
        }

        jsonBody = string(abi.encodePacked(jsonBody, '}'));

        return jsonBody;
    }

    function packJSON(string memory jsonString)
    internal pure returns (string memory)
    {
        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64Upgradeable.encode(bytes(jsonString))
            )
        );
    }
}
