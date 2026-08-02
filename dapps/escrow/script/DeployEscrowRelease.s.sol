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
    string private constant CAM_ROOT_PATH = "escrow/cam/main.json";

    struct ReleasePlan {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        bytes32 camHash;
        address intendedCamRootOwner;
    }

    struct OperatorInputs {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        address intendedCamRootOwner;
    }

    error InvalidReleasePlanSchema(string actual);
    error OperatorInputMismatch(string field);
    error InvalidSourceCommit(string sourceCommit);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error UnsupportedReleaseChainId(uint256 chainId);
    error CamHashSourceMismatch(bytes32 planned, bytes32 source);
    error ZeroCamHash();
    error EmptyCamURI();
    error ZeroCamRootOwner();

    function run() external returns (Deployment memory deployment) {
        ReleasePlan memory plan = _readPlan(vm.envString("ESCROW_RELEASE_PLAN_PATH"));
        _requireOperatorInputs(plan, _readOperatorInputs());
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

    function _readPlan(string memory path) internal view returns (ReleasePlan memory plan) {
        return _parsePlan(vm.readFile(path));
    }

    function _parsePlan(string memory json) internal view returns (ReleasePlan memory plan) {
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

    function _readOperatorInputs() internal view returns (OperatorInputs memory inputs) {
        inputs.sourceCommit = vm.envString("ESCROW_RELEASE_SOURCE_COMMIT");
        inputs.expectedChainId = vm.envUint("ESCROW_RELEASE_EXPECTED_CHAIN_ID");
        inputs.camURI = vm.envString("ESCROW_RELEASE_CAM_URI");
        inputs.intendedCamRootOwner = vm.envAddress("ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER");
    }

    function _requireOperatorInputs(ReleasePlan memory plan, OperatorInputs memory inputs) internal pure {
        _requireOperatorString("sourceCommit", plan.sourceCommit, inputs.sourceCommit);
        if (plan.expectedChainId != inputs.expectedChainId) {
            revert OperatorInputMismatch("expectedChainId");
        }
        _requireOperatorString("camURI", plan.camURI, inputs.camURI);
        if (plan.intendedCamRootOwner != inputs.intendedCamRootOwner) {
            revert OperatorInputMismatch("intendedCamRootOwner");
        }
    }

    function _requireOperatorString(string memory field, string memory actual, string memory expected) private pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert OperatorInputMismatch(field);
    }

    function _validatePlan(ReleasePlan memory plan) internal view {
        if (!_isSourceCommit(plan.sourceCommit)) revert InvalidSourceCommit(plan.sourceCommit);
        if (plan.expectedChainId != block.chainid) {
            revert ChainIdMismatch(plan.expectedChainId, block.chainid);
        }
        if (plan.expectedChainId == 1337 || plan.expectedChainId == 31337) {
            revert UnsupportedReleaseChainId(plan.expectedChainId);
        }
        if (plan.camHash == bytes32(0)) revert ZeroCamHash();
        if (bytes(plan.camURI).length == 0) revert EmptyCamURI();
        if (plan.intendedCamRootOwner == address(0)) revert ZeroCamRootOwner();

        bytes32 sourceCamHash = keccak256(vm.readFileBinary(CAM_ROOT_PATH));
        if (plan.camHash != sourceCamHash) {
            revert CamHashSourceMismatch(plan.camHash, sourceCamHash);
        }
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
