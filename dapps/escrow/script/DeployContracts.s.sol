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
    }

    function run() external returns (CamEscrow escrow) {
        string memory json = _readPlan();
        if (vm.parseJsonUint(json, ".expectedChainId") != block.chainid) revert InvalidBusinessPlan("expectedChainId");
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        escrow = deployEscrowContract();
        vm.stopBroadcast();
    }

    function verify() external view {
        string memory json = _readPlan();
        string memory candidate = vm.readFile(vm.envString("CONTRACT_RELEASE_CANDIDATE_PATH"));
        if (sha256(bytes(json)) != vm.parseJsonBytes32(candidate, ".planSha256")) {
            revert InvalidBusinessPlan("plan SHA-256");
        }
        _verifySource(candidate, "escrow", type(CamEscrow).creationCode);
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
