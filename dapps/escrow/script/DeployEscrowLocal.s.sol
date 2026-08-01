pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {EscrowLocalFixture} from "./EscrowLocalFixture.sol";

/// @notice Deploys the escrow CAM fixture to the local Anvil lane.
/// @dev This script is local-scenario infrastructure, not live-chain deployment
/// guidance. It uses an obvious fixture key supplied by Compose and performs no
/// production ownership, monitoring, or operational setup.
///
/// Required environment:
/// - PRIVATE_KEY: local deployer/CamRoot owner key used by Forge broadcast.
/// - CAM_URI: exact browser- or container-reachable CAM root URI.
/// - CAM_HASH: keccak256 hash of the checked-in CAM root bytes.
contract DeployEscrowLocal is Script, EscrowLocalFixture {
    function run() external returns (Deployment memory deployment) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        string memory camURI = vm.envString("CAM_URI");
        bytes32 camHash = vm.envBytes32("CAM_HASH");

        vm.startBroadcast(deployerKey);
        deployment = deployLocalFixture(deployer, camURI, camHash);
        vm.stopBroadcast();

        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("CamEscrow", address(deployment.escrow));
        console2.log("CamEscrowUI", address(deployment.ui));
    }
}
