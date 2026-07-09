pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {BikeNftLocalFixture} from "./BikeNftLocalFixture.sol";

/// @notice Deploys the bike NFT CAM fixture to the local Anvil lane.
/// @dev
/// This script deliberately seeds demo components, grants the broadcaster local
/// registrar authority, and uses zero admin delay. Do not use it as a live-chain
/// deployment script.
///
/// Required environment:
/// - PRIVATE_KEY: deployer/admin private key used by Forge broadcast.
/// - CAM_URI: exact CAM document URI to store in CamRoot.
/// - CAM_HASH: keccak256 hash of the CAM bytes, or bytes32(0) when the caller
///   explicitly chooses an unsigned local fixture.
contract DeployBikeNftLocal is Script, BikeNftLocalFixture {
    function run() external returns (Deployment memory deployment) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(deployerKey);

        string memory camURI = vm.envString("CAM_URI");
        bytes32 camHash = vm.envBytes32("CAM_HASH");

        vm.startBroadcast(deployerKey);
        deployment = deploySeededLocalFixture(admin, admin, camURI, camHash);
        vm.stopBroadcast();

        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("BicycleComponents", address(deployment.components));
        console2.log("BicycleComponentManager", address(deployment.manager));
        console2.log("BicycleComponentManagerUI", address(deployment.ui));
    }
}
