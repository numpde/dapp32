pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {EscrowDeployment} from "../../script/EscrowDeployment.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {CamEscrowUI} from "../../src/CamEscrowUI.sol";

contract EscrowUIDeploymentHarness is EscrowDeployment {
    function prepareUI(address escrow) external returns (CamEscrowUI) {
        return deployEscrowUI(escrow);
    }

    function activateUI(CamRoot root, CamEscrowUI ui) external {
        bindEscrowUI(root, ui);
    }

    function sourceUICodeHash(address escrow) external returns (bytes32) {
        return escrowUISourceCodeHash(escrow);
    }

    function deployFixture() external returns (Deployment memory) {
        return deployEscrow(address(this), "https://example.test/escrow/cam/main.json", bytes32(0));
    }
}

contract EscrowUIDeploymentTest is Test {
    function testReplacementUIIsInactiveUntilExplicitBinding() external {
        EscrowUIDeploymentHarness harness = new EscrowUIDeploymentHarness();
        EscrowDeployment.Deployment memory deployment = harness.deployFixture();
        CamEscrowUI replacement = harness.prepareUI(address(deployment.escrow));
        assertEq(deployment.camRoot.contractAddress("CamEscrowUI"), address(deployment.ui));
        assertEq(address(replacement.escrow()), address(deployment.escrow));
        assertEq(harness.sourceUICodeHash(address(deployment.escrow)), address(replacement).codehash);
        harness.activateUI(deployment.camRoot, replacement);
        assertEq(deployment.camRoot.contractAddress("CamEscrowUI"), address(replacement));
        assertEq(deployment.camRoot.contractAddress("CamEscrow"), address(deployment.escrow));
        assertEq(deployment.camRoot.owner(), address(harness));
        vm.etch(address(replacement), hex"00");
        assertNotEq(harness.sourceUICodeHash(address(deployment.escrow)), address(replacement).codehash);
    }
}
