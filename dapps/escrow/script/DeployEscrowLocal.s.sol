pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {EscrowDeployment} from "./EscrowDeployment.sol";

/// @notice Deploys the escrow CAM fixture to the local Anvil lane.
/// @dev This script is local-scenario infrastructure, not live-chain deployment
/// guidance. It uses an obvious fixture key supplied by Compose and performs no
/// production ownership, monitoring, or operational setup.
///
/// Required environment:
/// - PRIVATE_KEY: local deployer/CamRoot owner key used by Forge broadcast.
/// - CAM_URI: exact browser- or container-reachable CAM root URI.
///
/// The script hashes the mounted CAM root bytes before broadcasting.
contract DeployEscrowLocal is Script, EscrowDeployment {
    function run() external returns (Deployment memory deployment) {
        return _deploy(vm.envUint("PRIVATE_KEY"), vm.envString("CAM_URI"));
    }

    /// @dev The operator entry point reads ambient configuration; tests supply
    /// explicit fixture values while exercising the same deployment and hash.
    function _deploy(uint256 deployerKey, string memory camURI) internal returns (Deployment memory deployment) {
        address deployer = vm.addr(deployerKey);
        bytes32 camHash = sha256(vm.readFileBinary("escrow/cam/main.json"));

        vm.startBroadcast(deployerKey);
        deployment = deployEscrow(deployer, camURI, camHash);
        vm.stopBroadcast();

        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("CamEscrow", address(deployment.escrow));
        console2.log("CamEscrowUI", address(deployment.ui));
    }
}
