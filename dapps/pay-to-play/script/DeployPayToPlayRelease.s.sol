pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../src/PayToPlay.sol";
import {PayToPlayUI} from "../src/PayToPlayUI.sol";
import {PayToPlayContractDeployment} from "./PayToPlayContractDeployment.sol";
import {PayToPlayUIDeployment} from "./PayToPlayUIDeployment.sol";

/// @notice Deploys the pinned CAM and native-asset payment contract without fixture channels.
contract DeployPayToPlayRelease is Script, PayToPlayUIDeployment, PayToPlayContractDeployment {
    struct ReleasePlan {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        bytes32 camHash;
        address intendedCamRootOwner;
        address intendedPaymentAdmin;
        uint64 nullClaimPeriod;
    }

    error InvalidReleasePlan(string field);
    error OperatorInputMismatch(string field);

    function run() external returns (CamRoot root, PayToPlay payments) {
        ReleasePlan memory plan = _parsePlan(vm.readFile(vm.envString("PAY_TO_PLAY_RELEASE_PLAN_PATH")));
        _validatePlan(plan);
        _requireOperatorInputs(plan);
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        (root, payments) = _deploy(plan, vm.addr(key));
        vm.stopBroadcast();
        console2.log("CamRoot", address(root));
        console2.log("PayToPlay", address(payments));
        console2.log("PayToPlayUI", root.contractAddress("PayToPlayUI"));
        console2.log("IntendedCamRootOwner", plan.intendedCamRootOwner);
        console2.log("IntendedPaymentAdmin", plan.intendedPaymentAdmin);
    }

    function _deploy(ReleasePlan memory plan, address deployer) internal returns (CamRoot root, PayToPlay payments) {
        root = new CamRoot(deployer, plan.camURI, plan.camHash);
        payments = deployPayToPlayContract(deployer, plan.nullClaimPeriod);
        PayToPlayUI ui = deployPayToPlayUI(address(payments));
        root.setContractAddress("PayToPlay", address(payments));
        bindPayToPlayUI(root, ui);
        if (plan.intendedCamRootOwner != deployer) root.transferOwnership(plan.intendedCamRootOwner);
        nominatePayToPlayAdmin(payments, plan.intendedPaymentAdmin, deployer);
    }

    function _parsePlan(string memory json) internal view returns (ReleasePlan memory plan) {
        if (keccak256(bytes(vm.parseJsonString(json, ".schema"))) != keccak256("pay-to-play.release-plan.v1")) {
            revert InvalidReleasePlan("schema");
        }
        plan.sourceCommit = vm.parseJsonString(json, ".sourceCommit");
        plan.expectedChainId = vm.parseJsonUint(json, ".expectedChainId");
        plan.camURI = vm.parseJsonString(json, ".camURI");
        plan.camHash = vm.parseJsonBytes32(json, ".camHash");
        plan.intendedCamRootOwner = vm.parseJsonAddress(json, ".intendedCamRootOwner");
        plan.intendedPaymentAdmin = vm.parseJsonAddress(json, ".intendedPaymentAdmin");
        uint256 period = vm.parseJsonUint(json, ".nullClaimPeriod");
        if (period > 30 days) revert InvalidReleasePlan("nullClaimPeriod");
        plan.nullClaimPeriod = uint64(period);
    }

    function _validatePlan(ReleasePlan memory plan) internal view {
        bytes memory commit = bytes(plan.sourceCommit);
        if (commit.length != 40) revert InvalidReleasePlan("sourceCommit");
        for (uint256 i; i < commit.length; i++) {
            if (!((commit[i] >= 0x30 && commit[i] <= 0x39) || (commit[i] >= 0x61 && commit[i] <= 0x66))) {
                revert InvalidReleasePlan("sourceCommit");
            }
        }
        if (
            plan.expectedChainId != block.chainid || plan.expectedChainId == 0 || plan.expectedChainId == 1337
                || plan.expectedChainId == 31337
        ) {
            revert InvalidReleasePlan("expectedChainId");
        }
        if (bytes(plan.camURI).length == 0) revert InvalidReleasePlan("camURI");
        if (plan.camHash != bytes32(0) && plan.camHash != sha256(vm.readFileBinary("pay-to-play/cam/main.json"))) {
            revert InvalidReleasePlan("camHash");
        }
        if (plan.intendedCamRootOwner == address(0)) revert InvalidReleasePlan("intendedCamRootOwner");
        if (plan.intendedPaymentAdmin == address(0)) revert InvalidReleasePlan("intendedPaymentAdmin");
        if (plan.nullClaimPeriod > 30 days) revert InvalidReleasePlan("nullClaimPeriod");
    }

    function _requireOperatorInputs(ReleasePlan memory plan) internal view {
        _requireString("sourceCommit", plan.sourceCommit, vm.envString("PAY_TO_PLAY_RELEASE_SOURCE_COMMIT"));
        _requireString("camURI", plan.camURI, vm.envString("PAY_TO_PLAY_RELEASE_CAM_URI"));
        if (plan.expectedChainId != vm.envUint("PAY_TO_PLAY_RELEASE_EXPECTED_CHAIN_ID")) {
            revert OperatorInputMismatch("expectedChainId");
        }
        if (plan.intendedCamRootOwner != vm.envAddress("PAY_TO_PLAY_RELEASE_INTENDED_CAM_ROOT_OWNER")) {
            revert OperatorInputMismatch("intendedCamRootOwner");
        }
        if (plan.intendedPaymentAdmin != vm.envAddress("PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN")) {
            revert OperatorInputMismatch("intendedPaymentAdmin");
        }
        if (uint256(plan.nullClaimPeriod) != vm.envUint("PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD")) {
            revert OperatorInputMismatch("nullClaimPeriod");
        }
    }

    function _requireString(string memory field, string memory actual, string memory expected) private pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert OperatorInputMismatch(field);
    }
}
