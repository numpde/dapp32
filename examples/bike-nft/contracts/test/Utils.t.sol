pragma solidity ^0.8.18;

import "../src/Utils.sol";

contract UtilsTest {
    function test_escapeJSONString_escapesJSONSyntaxCharacters() external pure {
        assertStringEq(
            Utils.escapeJSONString('bike "alpha" \\ beta'),
            'bike \\"alpha\\" \\\\ beta'
        );
    }

    function test_escapeJSONString_escapesJSONControlCharacters() external pure {
        string memory input = string(
            abi.encodePacked(
                "a",
                bytes1(0x08),
                "b",
                bytes1(0x0c),
                "c",
                bytes1(0x0a),
                "d",
                bytes1(0x0d),
                "e",
                bytes1(0x09),
                "f"
            )
        );

        assertStringEq(Utils.escapeJSONString(input), "a\\bb\\fc\\nd\\re\\tf");
    }

    function test_escapeJSONString_escapesOtherControlCharactersAsUnicode() external pure {
        string memory input = string(abi.encodePacked("a", bytes1(0x01), "b", bytes1(0x1f), "c"));

        assertStringEq(Utils.escapeJSONString(input), "a\\u0001b\\u001fc");
    }

    function test_stringifyOnChainMetadata_escapesUserControlledFields() external pure {
        string memory name = 'bike","evil":true,"name":"copy';
        string memory description = "desc\\value";
        string memory imageURL = "https://example.test/image\".png";

        string[] memory traitTypes = new string[](1);
        traitTypes[0] = 'tier","extra":"field';

        string[] memory traitValues = new string[](1);
        traitValues[0] = string(abi.encodePacked("one", bytes1(0x0a), "two"));

        string memory metadata = Utils.stringifyOnChainMetadata(
            "",
            name,
            description,
            imageURL,
            traitTypes,
            traitValues
        );
        string memory expected = string(
            abi.encodePacked(
                '{"name":"',
                Utils.escapeJSONString(name),
                '","description":"',
                Utils.escapeJSONString(description),
                '","image":"',
                Utils.escapeJSONString(imageURL),
                '","attributes":[{"trait_type":"',
                Utils.escapeJSONString(traitTypes[0]),
                '","value":"',
                Utils.escapeJSONString(traitValues[0]),
                '"}]}'
            )
        );

        assertStringEq(metadata, expected);
    }

    function assertStringEq(string memory actual, string memory expected) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) {
            revert("string mismatch");
        }
    }
}
