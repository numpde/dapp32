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
    }

    function run() external returns (PayToPlay payments) {
        string memory json = _readPlan();
        if (vm.parseJsonUint(json, ".expectedChainId") != block.chainid) revert InvalidBusinessPlan("expectedChainId");
        address intendedAdmin = vm.parseJsonAddress(json, ".settings.intendedPaymentAdmin");
        uint256 period = vm.parseJsonUint(json, ".settings.nullClaimPeriod");
        if (period > type(uint64).max) revert InvalidBusinessPlan("nullClaimPeriod");
        uint64 nullClaimPeriod = uint64(period);
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        payments = deployPayToPlayContract(deployer, nullClaimPeriod);
        nominatePayToPlayAdmin(payments, intendedAdmin, deployer);
        vm.stopBroadcast();
    }

    function verify() external view {
        string memory json = _readPlan();
        string memory candidate = vm.readFile(vm.envString("CONTRACT_RELEASE_CANDIDATE_PATH"));
        if (sha256(bytes(json)) != vm.parseJsonBytes32(candidate, ".planSha256")) {
            revert InvalidBusinessPlan("plan SHA-256");
        }
        address creator = vm.parseJsonAddress(candidate, ".creator");
        uint256 period = vm.parseJsonUint(json, ".settings.nullClaimPeriod");
        if (period > type(uint64).max) revert InvalidBusinessPlan("nullClaimPeriod");
        _verifySource(
            candidate, "payments", abi.encodePacked(type(PayToPlay).creationCode, abi.encode(creator, uint64(period)))
        );
    }

    function _verifySource(string memory candidate, string memory role, bytes memory creation) private pure {
        if (
            keccak256(creation)
                != vm.parseJsonBytes32(candidate, string.concat(".contracts.", role, ".creationInputHash"))
        ) {
            revert InvalidBusinessPlan(string.concat(role, " original creation source"));
        }
    }
}
