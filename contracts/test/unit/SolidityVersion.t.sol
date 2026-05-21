pragma solidity 0.8.35;

interface Vm {
    struct DirEntry {
        string errorMessage;
        string path;
        uint64 depth;
        bool isDir;
        bool isSymlink;
    }

    function readDir(string calldata path, uint64 maxDepth) external view returns (DirEntry[] memory entries);
    function readFile(string calldata path) external view returns (string memory data);
}

contract SolidityVersionTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testSolidityPragmasMatchFoundryCompiler() external view {
        string memory expected = foundrySolcVersion();

        assertPragmasMatch("contracts/src", expected);
        assertPragmasMatch("contracts/test", expected);
    }

    function assertPragmasMatch(string memory path, string memory expected) internal view {
        Vm.DirEntry[] memory entries = vm.readDir(path, 10);

        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].isDir || !hasSuffix(entries[i].path, ".sol")) {
                continue;
            }

            string memory source = vm.readFile(entries[i].path);
            string memory actual = solidityPragma(source);

            if (bytes(actual).length == 0) {
                revert(string.concat(entries[i].path, ": missing Solidity pragma"));
            }

            if (!stringEq(actual, expected)) {
                revert(
                    string.concat(
                        entries[i].path, ": expected pragma solidity ", expected, "; got pragma solidity ", actual, ";"
                    )
                );
            }
        }
    }

    function foundrySolcVersion() internal view returns (string memory) {
        string memory toml = vm.readFile("foundry.toml");
        bytes memory data = bytes(toml);
        bytes memory needle = bytes('solc = "');

        for (uint256 i = 0; i + needle.length <= data.length; i++) {
            if (!matchesAt(data, needle, i)) {
                continue;
            }

            uint256 start = i + needle.length;
            uint256 end = start;

            while (end < data.length && data[end] != 0x22) {
                end++;
            }

            return slice(data, start, end);
        }

        revert("foundry.toml missing solc");
    }

    function solidityPragma(string memory source) internal pure returns (string memory) {
        bytes memory data = bytes(source);
        bytes memory needle = bytes("pragma solidity ");

        for (uint256 i = 0; i + needle.length <= data.length; i++) {
            if (!matchesAt(data, needle, i)) {
                continue;
            }

            uint256 start = i + needle.length;
            uint256 end = start;

            while (end < data.length && data[end] != 0x3b) {
                end++;
            }

            return trim(slice(data, start, end));
        }

        return "";
    }

    function matchesAt(bytes memory data, bytes memory needle, uint256 offset) internal pure returns (bool) {
        if (offset + needle.length > data.length) {
            return false;
        }

        for (uint256 i = 0; i < needle.length; i++) {
            if (data[offset + i] != needle[i]) {
                return false;
            }
        }

        return true;
    }

    function slice(bytes memory data, uint256 start, uint256 end) internal pure returns (string memory) {
        bytes memory out = new bytes(end - start);

        for (uint256 i = 0; i < out.length; i++) {
            out[i] = data[start + i];
        }

        return string(out);
    }

    function trim(string memory value) internal pure returns (string memory) {
        bytes memory data = bytes(value);
        uint256 start = 0;
        uint256 end = data.length;

        while (start < end && isSpace(data[start])) {
            start++;
        }

        while (end > start && isSpace(data[end - 1])) {
            end--;
        }

        return slice(data, start, end);
    }

    function isSpace(bytes1 value) internal pure returns (bool) {
        return value == 0x20 || value == 0x0a || value == 0x0d || value == 0x09;
    }

    function hasSuffix(string memory value, string memory suffix) internal pure returns (bool) {
        bytes memory valueBytes = bytes(value);
        bytes memory suffixBytes = bytes(suffix);

        if (suffixBytes.length > valueBytes.length) {
            return false;
        }

        uint256 offset = valueBytes.length - suffixBytes.length;

        for (uint256 i = 0; i < suffixBytes.length; i++) {
            if (valueBytes[offset + i] != suffixBytes[i]) {
                return false;
            }
        }

        return true;
    }

    function stringEq(string memory left, string memory right) internal pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
