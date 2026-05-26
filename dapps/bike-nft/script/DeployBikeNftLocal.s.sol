pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {BikeNftLocalFixture} from "./BikeNftLocalFixture.sol";

/// @notice Deploys the bike NFT CAM fixture to a local or explicitly selected chain.
/// @dev
/// Required environment:
/// - PRIVATE_KEY: deployer/admin private key used by Forge broadcast.
/// - CAM_URI: exact CAM document URI to store in CamRoot.
///
/// Optional environment:
/// - CAM_HASH: keccak256 hash of the CAM bytes. Defaults to bytes32(0) for
///   intentionally unsigned local fixtures.
contract DeployBikeNftLocal is Script, BikeNftLocalFixture {
    function run() external returns (Deployment memory deployment) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(deployerKey);

        string memory camURI = vm.envString("CAM_URI");
        // Intentional default: bytes32(0) means "unsigned CAM". This is
        // acceptable for a local fixture, but a real deploy lane should require
        // the operator to choose signed or unsigned CAM mode explicitly.
        bytes32 camHash = vm.envOr("CAM_HASH", bytes32(0));

        vm.startBroadcast(deployerKey);
        deployment = deploySeededLocalFixture(admin, camURI, camHash);
        vm.stopBroadcast();

        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("BicycleComponents", address(deployment.components));
        console2.log("BicycleComponentManager", address(deployment.manager));
        console2.log("BicycleComponentManagerUI", address(deployment.ui));
    }
}
