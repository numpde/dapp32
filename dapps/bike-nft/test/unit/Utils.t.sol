pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../src/Utils.sol";

/// @dev Metadata JSON is a public, user-controlled boundary: component names,
/// descriptions, image URLs, and attributes can be supplied by callers. These
/// tests protect against invalid JSON and field injection, not just cosmetic
/// escaping differences.
contract UtilsTest is Test {
    /// @dev Cover the three important escaping classes in one focused test:
    /// quotes/backslashes, short JSON escapes, and generic control characters.
    /// The final metadata assertion proves the escaping is used at every field
    /// insertion point in the token URI payload.
    function test_jsonMetadataEscapesUserControlledFieldsAndControlCharacters() external {
        assertStringEq(Utils.escapeJSONString('bike "alpha" \\ beta'), 'bike \\"alpha\\" \\\\ beta');

        string memory input = string(
            abi.encodePacked(
                "a", bytes1(0x08), "b", bytes1(0x0c), "c", bytes1(0x0a), "d", bytes1(0x0d), "e", bytes1(0x09), "f"
            )
        );

        assertStringEq(Utils.escapeJSONString(input), "a\\bb\\fc\\nd\\re\\tf");

        input = string(abi.encodePacked("a", bytes1(0x01), "b", bytes1(0x1f), "c"));

        assertStringEq(Utils.escapeJSONString(input), "a\\u0001b\\u001fc");

        string memory name = 'bike","evil":true,"name":"copy';
        string memory description = "desc\\value";
        string memory imageURL = "https://example.test/image\".png";

        string[] memory traitTypes = new string[](1);
        traitTypes[0] = 'tier","extra":"field';

        string[] memory traitValues = new string[](1);
        traitValues[0] = string(abi.encodePacked("one", bytes1(0x0a), "two"));

        string memory metadata =
            Utils.stringifyOnChainMetadata("", name, description, imageURL, traitTypes, traitValues);
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

    /// @dev Keep string comparisons explicit so Solidity failures show the
    /// mismatched JSON text instead of only reporting byte-level inequality.
    function assertStringEq(string memory actual, string memory expected) internal {
        assertEq(actual, expected, "string mismatch");
    }
}
