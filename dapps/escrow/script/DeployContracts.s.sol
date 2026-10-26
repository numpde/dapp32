pragma solidity 0.8.35;

import {Script} from "forge-std-1.12.0/src/Script.sol";
import {CamEscrow} from "../src/CamEscrow.sol";
import {EscrowContractDeployment} from "./EscrowContractDeployment.sol";

contract DeployContracts is Script, EscrowContractDeployment {
    error InvalidBusinessPlan(string field);

    function _readPlan() private view returns (string memory json) {
        json = vm.readFile(vm.envString("CONTRACT_RELEASE_PLAN_PATH"));
        if (keccak256(bytes(vm.parseJsonString(json, ".schema"))) != keccak256("cam.contract-release-plan.v1")) {
            revert InvalidBusinessPlan("schema");
        }
        if (keccak256(bytes(vm.parseJsonString(json, ".app"))) != keccak256("escrow")) {
            revert InvalidBusinessPlan("app");
        }
        uint256 chainId = vm.parseJsonUint(json, ".expectedChainId");
        if (chainId != block.chainid) {
            revert InvalidBusinessPlan("expectedChainId");
        }
    }

    function run() external returns (CamEscrow escrow) {
        string memory json = _readPlan();
        if (vm.parseJsonKeys(json, ".settings").length != 0) revert InvalidBusinessPlan("settings");
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        escrow = deployEscrowContract();
        vm.stopBroadcast();
    }
}
