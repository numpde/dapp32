pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {BikeNftReleaseVerifier} from "./BikeNftReleaseVerifier.sol";

/// @notice Verifies a Bike NFT artifact through a read-only RPC without accepting a key or broadcast flag.
contract VerifyBikeNftRelease is Script, BikeNftReleaseVerifier {
    error AdminDelayOutOfRange(string field, uint256 value);

    function run() external {
        Artifact memory artifact = _readArtifact(vm.envString("BIKE_NFT_VERIFIED_DEPLOYMENT_PATH"));
        verifyArtifact(artifact, vm.envString("BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT"));
        console2.log("BikeNftReleaseVerified", true);
        console2.log("CamRoot", artifact.camRoot);
        console2.log("BicycleComponents", artifact.components);
        console2.log("BicycleComponentManager", artifact.manager);
        console2.log("BicycleComponentManagerUI", artifact.ui);
    }

    function _readArtifact(string memory path) internal view returns (Artifact memory artifact) {
        string memory json = vm.readFile(path);
        artifact.sourceCommit = vm.parseJsonString(json, ".sourceCommit");
        artifact.chainId = vm.parseJsonUint(json, ".chainId");
        artifact.deployer = vm.parseJsonAddress(json, ".deployer");
        artifact.camURI = vm.parseJsonString(json, ".camURI");
        artifact.camHash = vm.parseJsonBytes32(json, ".camHash");
        artifact.intendedCamRootOwner = vm.parseJsonAddress(json, ".intendedCamRootOwner");
        artifact.tokenName = vm.parseJsonString(json, ".tokenName");
        artifact.tokenSymbol = vm.parseJsonString(json, ".tokenSymbol");
        artifact.baseTokenURI = vm.parseJsonString(json, ".baseTokenURI");
        artifact.collectionURI = vm.parseJsonString(json, ".collectionURI");
        artifact.intendedComponentsAdmin = vm.parseJsonAddress(json, ".intendedComponentsAdmin");
        artifact.componentsAdminDelay = _readDelay(json, ".componentsAdminDelay");
        artifact.componentsPauser = vm.parseJsonAddress(json, ".componentsPauser");
        artifact.componentsConfigurer = vm.parseJsonAddress(json, ".componentsConfigurer");
        artifact.intendedManagerAdmin = vm.parseJsonAddress(json, ".intendedManagerAdmin");
        artifact.managerAdminDelay = _readDelay(json, ".managerAdminDelay");
        artifact.managerPauser = vm.parseJsonAddress(json, ".managerPauser");
        artifact.managerConfigurer = vm.parseJsonAddress(json, ".managerConfigurer");
        artifact.registrars = vm.parseJsonAddressArray(json, ".registrars");
        artifact.camRoot = vm.parseJsonAddress(json, ".camRoot");
        artifact.components = vm.parseJsonAddress(json, ".components");
        artifact.manager = vm.parseJsonAddress(json, ".manager");
        artifact.ui = vm.parseJsonAddress(json, ".ui");
        artifact.camRootCodeHash = vm.parseJsonBytes32(json, ".camRootCodeHash");
        artifact.componentsCodeHash = vm.parseJsonBytes32(json, ".componentsCodeHash");
        artifact.managerCodeHash = vm.parseJsonBytes32(json, ".managerCodeHash");
        artifact.uiCodeHash = vm.parseJsonBytes32(json, ".uiCodeHash");
    }

    function _readDelay(string memory json, string memory field) private view returns (uint48) {
        uint256 value = vm.parseJsonUint(json, field);
        if (value > type(uint48).max) revert AdminDelayOutOfRange(field, value);
        return uint48(value);
    }
}
