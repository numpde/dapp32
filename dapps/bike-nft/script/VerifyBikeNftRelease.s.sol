pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {BikeNftReleaseVerifier} from "./BikeNftReleaseVerifier.sol";

/// @notice Verifies a Bike NFT artifact through a read-only RPC without accepting a key or broadcast flag.
contract VerifyBikeNftRelease is Script, BikeNftReleaseVerifier {
    function run() external {
        requireDeploymentSchema(vm.envString("BIKE_NFT_DEPLOYMENT_SCHEMA"));
        Artifact memory artifact = _readEnvironment();
        verifyArtifact(artifact, vm.envString("BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT"));
        console2.log("BikeNftReleaseVerified", true);
        console2.log("CamRoot", artifact.camRoot);
        console2.log("BicycleComponents", artifact.components);
        console2.log("BicycleComponentManager", artifact.manager);
        console2.log("BicycleComponentManagerUI", artifact.ui);
    }

    function _readEnvironment() private view returns (Artifact memory artifact) {
        artifact.sourceCommit = vm.envString("BIKE_NFT_DEPLOYMENT_SOURCE_COMMIT");
        artifact.chainId = vm.envUint("BIKE_NFT_DEPLOYMENT_CHAIN_ID");
        artifact.deployer = vm.envAddress("BIKE_NFT_DEPLOYMENT_DEPLOYER");
        artifact.camURI = vm.envString("BIKE_NFT_DEPLOYMENT_CAM_URI");
        artifact.camHash = vm.envBytes32("BIKE_NFT_DEPLOYMENT_CAM_HASH");
        artifact.camRootOwner = vm.envAddress("BIKE_NFT_DEPLOYMENT_CAM_ROOT_OWNER");
        artifact.tokenName = vm.envString("BIKE_NFT_DEPLOYMENT_TOKEN_NAME");
        artifact.tokenSymbol = vm.envString("BIKE_NFT_DEPLOYMENT_TOKEN_SYMBOL");
        artifact.baseTokenURI = vm.envString("BIKE_NFT_DEPLOYMENT_BASE_TOKEN_URI");
        artifact.collectionURI = vm.envString("BIKE_NFT_DEPLOYMENT_COLLECTION_URI");
        artifact.componentsAdmin = vm.envAddress("BIKE_NFT_DEPLOYMENT_COMPONENTS_ADMIN");
        artifact.componentsAdminDelay = uint48(vm.envUint("BIKE_NFT_DEPLOYMENT_COMPONENTS_ADMIN_DELAY"));
        artifact.componentsPauser = vm.envAddress("BIKE_NFT_DEPLOYMENT_COMPONENTS_PAUSER");
        artifact.componentsConfigurer = vm.envAddress("BIKE_NFT_DEPLOYMENT_COMPONENTS_CONFIGURER");
        artifact.managerAdmin = vm.envAddress("BIKE_NFT_DEPLOYMENT_MANAGER_ADMIN");
        artifact.managerAdminDelay = uint48(vm.envUint("BIKE_NFT_DEPLOYMENT_MANAGER_ADMIN_DELAY"));
        artifact.managerPauser = vm.envAddress("BIKE_NFT_DEPLOYMENT_MANAGER_PAUSER");
        artifact.managerConfigurer = vm.envAddress("BIKE_NFT_DEPLOYMENT_MANAGER_CONFIGURER");
        artifact.registrars = vm.envAddress("BIKE_NFT_DEPLOYMENT_REGISTRARS", ",");
        artifact.camRoot = vm.envAddress("BIKE_NFT_DEPLOYMENT_CAM_ROOT");
        artifact.components = vm.envAddress("BIKE_NFT_DEPLOYMENT_COMPONENTS");
        artifact.manager = vm.envAddress("BIKE_NFT_DEPLOYMENT_MANAGER");
        artifact.ui = vm.envAddress("BIKE_NFT_DEPLOYMENT_UI");
        artifact.camRootCodeHash = vm.envBytes32("BIKE_NFT_DEPLOYMENT_CAM_ROOT_CODE_HASH");
        artifact.componentsCodeHash = vm.envBytes32("BIKE_NFT_DEPLOYMENT_COMPONENTS_CODE_HASH");
        artifact.managerCodeHash = vm.envBytes32("BIKE_NFT_DEPLOYMENT_MANAGER_CODE_HASH");
        artifact.uiCodeHash = vm.envBytes32("BIKE_NFT_DEPLOYMENT_UI_CODE_HASH");
    }
}
