pragma solidity 0.8.35;

import {Script} from "forge-std-1.12.0/src/Script.sol";
import {PayToPlay} from "../src/PayToPlay.sol";
import {PayToPlayContractDeployment} from "./PayToPlayContractDeployment.sol";

contract DeployContracts is Script, PayToPlayContractDeployment {
    error InvalidBusinessPlan(string field);

    function _readPlan() private view returns (string memory json) {
        json = vm.readFile(vm.envString("CONTRACT_RELEASE_PLAN_PATH"));
        if (keccak256(bytes(vm.parseJsonString(json, ".schema"))) != keccak256("cam.contract-release-plan.v1")) {
            revert InvalidBusinessPlan("schema");
        }
        if (keccak256(bytes(vm.parseJsonString(json, ".app"))) != keccak256("pay-to-play")) {
            revert InvalidBusinessPlan("app");
        }
        uint256 chainId = vm.parseJsonUint(json, ".expectedChainId");
        if (chainId != block.chainid) {
            revert InvalidBusinessPlan("expectedChainId");
        }
    }

    function run() external returns (PayToPlay payments) {
        string memory json = _readPlan();
        address intendedAdmin = vm.parseJsonAddress(json, ".settings.intendedPaymentAdmin");
        uint256 period = vm.parseJsonUint(json, ".settings.nullClaimPeriod");
        if (intendedAdmin == address(0)) revert InvalidBusinessPlan("intendedPaymentAdmin");
        if (period > 30 days) revert InvalidBusinessPlan("nullClaimPeriod");
        uint64 nullClaimPeriod = uint64(period);
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        payments = deployPayToPlayContract(deployer, nullClaimPeriod);
        nominatePayToPlayAdmin(payments, intendedAdmin, deployer);
        vm.stopBroadcast();
    }
}
