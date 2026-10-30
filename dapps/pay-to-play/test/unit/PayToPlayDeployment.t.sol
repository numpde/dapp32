pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayUI} from "../../src/PayToPlayUI.sol";
import {PayToPlayContractDeployment} from "../../script/PayToPlayContractDeployment.sol";
import {PayToPlayUIDeployment} from "../../script/PayToPlayUIDeployment.sol";

contract PayToPlayDeploymentHarness is PayToPlayContractDeployment, PayToPlayUIDeployment {
    function prepareUI(address payments) external returns (PayToPlayUI) {
        return deployPayToPlayUI(payments);
    }

    function activateUI(CamRoot root, PayToPlayUI ui) external {
        bindPayToPlayUI(root, ui);
    }

    function sourceUICodeHash(address payments) external returns (bytes32) {
        return payToPlayUISourceCodeHash(payments);
    }

    function createPayments(uint64 period) external returns (PayToPlay) {
        return deployPayToPlayContract(address(this), period);
    }

    function deployFixture(uint64 period, address rootOwner, address admin)
        external
        returns (CamRoot root, PayToPlay payments)
    {
        payments = deployPayToPlayContract(address(this), period);
        nominatePayToPlayAdmin(payments, admin, address(this));
        PayToPlayUI ui = deployPayToPlayUI(address(payments));
        root = new CamRoot(address(this), "https://example.test/pay-to-play/cam/main.json", bytes32(0));
        root.setContractAddress("PayToPlay", address(payments));
        bindPayToPlayUI(root, ui);
        if (rootOwner != address(this)) root.transferOwnership(rootOwner);
    }
}

contract PayToPlayDeploymentTest is Test {
    address private constant ROOT_OWNER = address(0xBEEF);
    address private constant ADMIN = address(0xCAFE);
    PayToPlayDeploymentHarness private harness;

    function setUp() external {
        harness = new PayToPlayDeploymentHarness();
    }

    function testDeploymentSeparatesAuthoritiesAndCreatesOnlyReservedChannel() external {
        (CamRoot root, PayToPlay payments) = harness.deployFixture(60, ROOT_OWNER, ADMIN);
        assertEq(root.owner(), address(harness));
        assertEq(root.pendingOwner(), ROOT_OWNER);
        assertEq(payments.owner(), address(harness));
        assertEq(payments.pendingOwner(), ADMIN);
        assertEq(root.contractAddress("PayToPlay"), address(payments));
        address ui = root.contractAddress("PayToPlayUI");
        assertTrue(ui != address(0), "a fresh deployment must bind its read-only signing projection");
        assertEq(address(PayToPlayUI(ui).payments()), address(payments));
        assertEq(payments.channelCount(), 1);
        assertEq(payments.channel(0).claimPeriod, 60);
        assertEq(payments.channel(0).payee, address(0));
    }

    function testReplacementUIIsInactiveUntilExplicitBinding() external {
        (CamRoot root, PayToPlay payments) = harness.deployFixture(60, ROOT_OWNER, ADMIN);
        address previousUI = root.contractAddress("PayToPlayUI");
        PayToPlayUI replacement = harness.prepareUI(address(payments));
        assertEq(root.contractAddress("PayToPlayUI"), previousUI);
        assertEq(address(replacement.payments()), address(payments));
        assertEq(harness.sourceUICodeHash(address(payments)), address(replacement).codehash);
        harness.activateUI(root, replacement);
        assertEq(root.contractAddress("PayToPlayUI"), address(replacement));
        assertEq(root.contractAddress("PayToPlay"), address(payments));
        assertEq(root.owner(), address(harness));
        assertEq(root.pendingOwner(), ROOT_OWNER);
        assertEq(payments.channelCount(), 1);
        vm.etch(address(replacement), hex"00");
        assertNotEq(harness.sourceUICodeHash(address(payments)), address(replacement).codehash);
    }

    function testAcceptsZeroAndMaximumWait() external {
        assertEq(harness.createPayments(0).channel(0).claimPeriod, 0);
        assertEq(harness.createPayments(30 days).channel(0).claimPeriod, 30 days);
    }

    function testBusinessConstructionRejectsTooLongWait() external {
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ClaimPeriodTooLong.selector, uint64(30 days + 1)));
        harness.createPayments(30 days + 1);
    }
}
