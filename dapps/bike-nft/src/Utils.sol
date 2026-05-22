pragma solidity 0.8.35;

import "@openzeppelin/contracts-upgradeable/utils/Base64Upgradeable.sol";


library Utils {
    function stringifyOnChainMetadata(string memory spacer, string memory name, string memory description, string memory imageURL, string[] memory traitTypes, string[] memory traitValues)
    internal pure returns (string memory)
    {
        string memory jsonBody = string(
            abi.encodePacked(
                '{',
                '"name":"', escapeJSONString(name), '",', spacer,
                '"description":"', escapeJSONString(description), '",', spacer,
                '"image":"', escapeJSONString(imageURL), '"'
            )
        );

        require(traitTypes.length == traitValues.length, "Type/Value arrays must have the same length");

        if (traitTypes.length > 0) {
            jsonBody = string(abi.encodePacked(jsonBody, ',', spacer, '"attributes":['));

            for (uint i = 0; i < traitTypes.length; i++) {
                if (i > 0) {
                    jsonBody = string(abi.encodePacked(jsonBody, ','));
                }

                jsonBody = string(
                    abi.encodePacked(
                        jsonBody,
                        '{"trait_type":"',
                        escapeJSONString(traitTypes[i]),
                        '",',
                        spacer,
                        '"value":"',
                        escapeJSONString(traitValues[i]),
                        '"}'
                    )
                );
            }

            jsonBody = string(abi.encodePacked(jsonBody, ']'));
        }

        jsonBody = string(abi.encodePacked(jsonBody, '}'));

        return jsonBody;
    }

    function escapeJSONString(string memory value)
    internal pure returns (string memory)
    {
        bytes memory input = bytes(value);
        bytes memory output;

        for (uint i = 0; i < input.length; i++) {
            bytes1 char = input[i];

            if (char == bytes1(0x22)) {
                output = abi.encodePacked(output, '\\"');
            } else if (char == bytes1(0x5c)) {
                output = abi.encodePacked(output, "\\\\");
            } else if (char == bytes1(0x08)) {
                output = abi.encodePacked(output, "\\b");
            } else if (char == bytes1(0x0c)) {
                output = abi.encodePacked(output, "\\f");
            } else if (char == bytes1(0x0a)) {
                output = abi.encodePacked(output, "\\n");
            } else if (char == bytes1(0x0d)) {
                output = abi.encodePacked(output, "\\r");
            } else if (char == bytes1(0x09)) {
                output = abi.encodePacked(output, "\\t");
            } else if (uint8(char) < 0x20) {
                output = abi.encodePacked(output, "\\u00", _hexDigit(uint8(char) >> 4), _hexDigit(uint8(char) & 0x0f));
            } else {
                output = abi.encodePacked(output, char);
            }
        }

        return string(output);
    }

    function _hexDigit(uint8 value)
    private pure returns (bytes1)
    {
        return value < 10 ? bytes1(value + 0x30) : bytes1(value + 0x57);
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
