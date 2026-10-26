pragma solidity 0.8.35;

import {Script} from "forge-std-1.12.0/src/Script.sol";

/// @notice Deploys only a read-only UI, then verifies it through a separate keyless invocation.
abstract contract UIReleaseScript is Script {
    error UIReleaseMismatch(string field);
    error UISourceMismatch(address ui, bytes32 expected, bytes32 actual);

    function run() external returns (address ui) {
        string memory plan = _readPlan();
        _requireChain(plan);
        address backing = vm.parseJsonAddress(plan, ".backing.address");
        uint256 key = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(key);
        ui = _deployUI(backing);
        vm.stopBroadcast();
    }

    function verify() external {
        string memory plan = _readPlan();
        string memory candidate = vm.readFile(vm.envString("UI_RELEASE_CANDIDATE_PATH"));
        if (sha256(bytes(plan)) != vm.parseJsonBytes32(candidate, ".planSha256")) {
            revert UIReleaseMismatch("plan SHA-256");
        }
        string memory blockTag = vm.parseJsonString(candidate, ".verificationBlock.number");
        vm.createSelectFork(vm.envString("UI_RELEASE_RPC_URL"), vm.parseUint(blockTag));
        _requireChain(plan);
        address backing = vm.parseJsonAddress(plan, ".backing.address");
        if (backing.codehash != vm.parseJsonBytes32(plan, ".backing.codeHash")) {
            revert UIReleaseMismatch("backing runtime");
        }
        address ui = vm.parseJsonAddress(candidate, ".ui.address");
        bytes32 actual = ui.codehash;
        if (actual != vm.parseJsonBytes32(candidate, ".ui.codeHash")) revert UIReleaseMismatch("observed UI runtime");
        bytes32 expected = _uiSourceCodeHash(backing);
        if (actual != expected) revert UISourceMismatch(ui, expected, actual);
        if (_uiBacking(ui) != backing) revert UIReleaseMismatch("UI backing contract");
    }

    function _readPlan() private view returns (string memory plan) {
        plan = vm.readFile(vm.envString("UI_RELEASE_PLAN_PATH"));
        if (keccak256(bytes(vm.parseJsonString(plan, ".schema"))) != keccak256("cam.ui-release-plan.v1")) {
            revert UIReleaseMismatch("plan schema");
        }
        if (keccak256(bytes(vm.parseJsonString(plan, ".app"))) != keccak256(bytes(_uiApp()))) {
            revert UIReleaseMismatch("plan app");
        }
    }

    function _requireChain(string memory plan) private view {
        if (block.chainid != vm.parseJsonUint(plan, ".expectedChainId")) revert UIReleaseMismatch("chain ID");
    }

    function _uiApp() internal pure virtual returns (string memory);
    function _deployUI(address backing) internal virtual returns (address);
    function _uiSourceCodeHash(address backing) internal virtual returns (bytes32);
    function _uiBacking(address ui) internal view virtual returns (address);
}
