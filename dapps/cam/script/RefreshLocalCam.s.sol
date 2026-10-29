pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";
import {CamRoot} from "../src/CamRoot.sol";

/// @notice Republish edited CAM bytes on an existing disposable local fixture.
contract RefreshLocalCam is Script {
    uint256 private constant FIXTURE_KEY = 0xbabababababababababababababababababababababababababababababababa;

    function run(string memory deploymentJSON, string memory manifestPath) external {
        require(block.chainid == 31337, "CAM refresh requires local fixture chain 31337");
        require(vm.parseJsonUint(deploymentJSON, ".chain") == 31337, "Saved deployment is not a local fixture");
        (CamRoot root, string memory uri) = recordedRoot(deploymentJSON);
        require(root.owner() == vm.addr(FIXTURE_KEY), "CAM root is not owned by the public fixture account");
        require(keccak256(bytes(uri)) == keccak256(bytes(vm.envString("CAM_URI"))), "Fixture origin changed");
        require(keccak256(bytes(root.camManifest().uri)) == keccak256(bytes(uri)), "CAM manifest URI changed");
        bytes32 digest = sha256(vm.readFileBinary(manifestPath));
        if (root.camManifest().sha256Digest != digest) {
            vm.startBroadcast(FIXTURE_KEY);
            root.setCam(uri, digest);
            vm.stopBroadcast();
        }
        console2.log("CamRoot", address(root));
        console2.logBytes32(digest);
    }

    function recordedRoot(string memory deploymentJSON) private view returns (CamRoot root, string memory uri) {
        for (uint256 i; vm.keyExistsJson(deploymentJSON, string.concat(".transactions[", vm.toString(i), "]")); ++i) {
            string memory path = string.concat(".transactions[", vm.toString(i), "]");
            if (
                keccak256(bytes(vm.parseJsonString(deploymentJSON, string.concat(path, ".transactionType"))))
                    != keccak256("CREATE")
            ) continue;
            if (
                keccak256(bytes(vm.parseJsonString(deploymentJSON, string.concat(path, ".contractName"))))
                    != keccak256("CamRoot")
            ) continue;
            require(address(root) == address(0), "Saved deployment has multiple CAM roots");
            root = CamRoot(vm.parseJsonAddress(deploymentJSON, string.concat(path, ".contractAddress")));
            string[] memory arguments = vm.parseJsonStringArray(deploymentJSON, string.concat(path, ".arguments"));
            require(
                arguments.length == 3 && vm.parseAddress(arguments[0]) == vm.addr(FIXTURE_KEY),
                "Saved CAM owner is not the fixture account"
            );
            uri = arguments[1];
        }
        require(address(root) != address(0), "Saved deployment has no CAM root");
    }
}
