pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {EscrowDeployment} from "./EscrowDeployment.sol";

/// @notice Deploys one pinned escrow release to one explicitly selected chain.
/// @dev
/// The release plan is produced offline from the checked-in CAM bytes. The
/// broadcaster temporarily owns CamRoot so the two contract bindings can be set.
/// If the intended owner differs, this script starts Ownable2Step transfer; the
/// release remains unverified until that owner accepts independently.
contract DeployEscrowRelease is Script, EscrowDeployment {
    string private constant RELEASE_PLAN_SCHEMA = "escrow.release-plan.v1";

    struct ReleasePlan {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        bytes32 camHash;
        address intendedCamRootOwner;
    }

    error InvalidReleasePlanSchema(string actual);
    error InvalidSourceCommit(string sourceCommit);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error ZeroCamHash();
    error EmptyCamURI();
    error ZeroCamRootOwner();

    function run() external returns (Deployment memory deployment) {
        ReleasePlan memory plan = _readPlan(vm.envString("ESCROW_RELEASE_PLAN_PATH"));
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        _validatePlan(plan);

        vm.startBroadcast(deployerKey);
        deployment = deployEscrow(deployer, plan.camURI, plan.camHash);
        if (plan.intendedCamRootOwner != deployer) {
            deployment.camRoot.transferOwnership(plan.intendedCamRootOwner);
        }
        vm.stopBroadcast();

        console2.log("SourceCommit", plan.sourceCommit);
        console2.log("ChainId", block.chainid);
        console2.log("Deployer", deployer);
        console2.log("IntendedCamRootOwner", plan.intendedCamRootOwner);
        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("CamEscrow", address(deployment.escrow));
        console2.log("CamEscrowUI", address(deployment.ui));
        console2.log("CamRootOwner", deployment.camRoot.owner());
        console2.log("CamRootPendingOwner", deployment.camRoot.pendingOwner());
    }

    function _readPlan(string memory path) private view returns (ReleasePlan memory plan) {
        string memory json = vm.readFile(path);
        string memory schema = vm.parseJsonString(json, ".schema");
        if (keccak256(bytes(schema)) != keccak256(bytes(RELEASE_PLAN_SCHEMA))) {
            revert InvalidReleasePlanSchema(schema);
        }

        plan.sourceCommit = vm.parseJsonString(json, ".sourceCommit");
        plan.expectedChainId = vm.parseJsonUint(json, ".expectedChainId");
        plan.camURI = vm.parseJsonString(json, ".camURI");
        plan.camHash = vm.parseJsonBytes32(json, ".camHash");
        plan.intendedCamRootOwner = vm.parseJsonAddress(json, ".intendedCamRootOwner");
    }

    function _validatePlan(ReleasePlan memory plan) private view {
        if (!_isSourceCommit(plan.sourceCommit)) revert InvalidSourceCommit(plan.sourceCommit);
        if (plan.expectedChainId != block.chainid) {
            revert ChainIdMismatch(plan.expectedChainId, block.chainid);
        }
        if (plan.camHash == bytes32(0)) revert ZeroCamHash();
        if (bytes(plan.camURI).length == 0) revert EmptyCamURI();
        if (plan.intendedCamRootOwner == address(0)) revert ZeroCamRootOwner();
    }

    function _isSourceCommit(string memory value) private pure returns (bool) {
        bytes memory characters = bytes(value);
        if (characters.length != 40) return false;

        for (uint256 i = 0; i < characters.length; i++) {
            uint8 character = uint8(characters[i]);
            bool decimal = character >= 48 && character <= 57;
            bool lowercaseHex = character >= 97 && character <= 102;
            if (!decimal && !lowercaseHex) return false;
        }
        return true;
    }
}
