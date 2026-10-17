pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract RejectingVoucherPolicy {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        revert("wallet policy must not be consulted");
    }

    receive() external payable {}
}

contract PayToPlayVoucherKeyTest is PayToPlayTestBase {
    event VoucherKeyRegistered(address indexed customer, uint256 indexed channelId, address indexed voucherKey);

    function testRegistrationIsOwnerScopedAndAvailableWithoutFunding() public {
        uint256 fresh = payments.createChannel(payee, PERIOD);
        address key = vm.addr(VOUCHER_KEY);
        PayToPlay.PositionView memory before_ = payments.viewPosition(customer, fresh, customer);
        assertEq(before_.voucherKey, address(0));
        assertTrue(_hasAction(before_.actions, "registerVoucherKey"));
        assertFalse(_hasAction(before_.actions, "collect"));
        assertFalse(_hasAction(payments.viewPosition(customer, fresh, relayer).actions, "registerVoucherKey"));
        vm.prank(relayer);
        payments.registerVoucherKey(fresh, relayer);
        assertEq(payments.viewPosition(customer, fresh, customer).voucherKey, address(0));
        vm.expectEmit(true, true, true, true, address(payments));
        emit VoucherKeyRegistered(customer, fresh, key);
        vm.prank(customer);
        payments.registerVoucherKey(fresh, key);
        PayToPlay.PositionView memory after_ = payments.viewPosition(customer, fresh, customer);
        assertEq(after_.voucherKey, key);
        assertEq(after_.balance, 0);
        assertEq(after_.voucherPaid, 0);
        assertFalse(_hasAction(after_.actions, "registerVoucherKey"));
        assertTrue(_hasAction(payments.viewPosition(customer, fresh, relayer).actions, "collect"));
        assertEq(payments.viewPosition(relayer, fresh, relayer).voucherKey, relayer);
    }

    function testRegistrationRejectsNullMissingAndZeroKey() public {
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.NullChannelCannotCollect.selector);
        payments.registerVoucherKey(0, vm.addr(VOUCHER_KEY));
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, 99));
        payments.registerVoucherKey(99, vm.addr(VOUCHER_KEY));
        vm.stopPrank();
        uint256 fresh = payments.createChannel(payee, PERIOD);
        vm.prank(customer);
        vm.expectRevert(PayToPlay.InvalidVoucherKey.selector);
        payments.registerVoucherKey(fresh, address(0));
        assertEq(payments.viewPosition(customer, fresh, customer).voucherKey, address(0));
        assertFalse(_hasAction(_position(0).actions, "registerVoucherKey"));
    }

    function testKeyCannotBeReplacedEvenWhenEmptyOrBySameKey() public {
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.VoucherKeyAlreadyRegistered.selector);
        payments.registerVoucherKey(channel, vm.addr(VOUCHER_KEY));
        vm.expectRevert(PayToPlay.VoucherKeyAlreadyRegistered.selector);
        payments.registerVoucherKey(channel, vm.addr(CUSTOMER_KEY));
        vm.stopPrank();
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
    }

    function testUnregisteredPositionCannotCollectButCanRecoverItsFunds() public {
        uint256 fresh = payments.createChannel(payee, PERIOD);
        _fund(customer, fresh, 100);
        bytes memory signature = _sign(customer, fresh, 100);
        vm.expectRevert(PayToPlay.VoucherKeyNotRegistered.selector);
        payments.collect(customer, fresh, 100, signature);
        vm.prank(customer);
        payments.requestWithdrawal(fresh, 100);
        vm.warp(_position(fresh).readyAt);
        assertEq(payments.withdraw(customer, fresh), 100);
        assertEq(_position(fresh).voucherKey, address(0));
    }

    function testRegistrationAfterFundingPreservesAccountingAndDeadline() public {
        uint256 fresh = payments.createChannel(payee, PERIOD);
        _fund(customer, fresh, 100);
        vm.prank(customer);
        payments.requestWithdrawal(fresh, 40);
        uint256 ready = _position(fresh).readyAt;
        vm.warp(block.timestamp + 10);
        vm.prank(customer);
        payments.registerVoucherKey(fresh, vm.addr(VOUCHER_KEY));
        PayToPlay.PositionView memory position = _position(fresh);
        assertEq(position.balance, 100);
        assertEq(position.voucherPaid, 0);
        assertEq(position.requestedAmount, 40);
        assertEq(position.readyAt, ready);
        assertEq(position.effectiveBalance, 60);
    }

    function testCustomerSignatureDoesNotSubstituteForDistinctVoucherKey() public {
        _fund(customer, channel, 100);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(CUSTOMER_KEY, payments.voucherDigest(customer, channel, 100));
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 100, abi.encodePacked(r, s, v));
        assertEq(_position(channel).balance, 100);
        assertEq(_position(channel).voucherPaid, 0);
        assertEq(payments.collect(customer, channel, 100, _sign(customer, channel, 100)), 100);
    }

    function testVoucherKeyHasNoAuthorityOverCustomersWithdrawal() public {
        _fund(customer, channel, 100);
        vm.prank(vm.addr(VOUCHER_KEY));
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.InvalidWithdrawalAmount.selector, 1, 0));
        payments.requestWithdrawal(channel, 1);
        assertEq(_position(channel).requestedAmount, 0);
    }

    function testCodeChangesAtCustomerAndKeyCannotInvalidateVoucher() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 100);
        RejectingVoucherPolicy policy = new RejectingVoucherPolicy();
        // Model changing account code, including the validation-policy change enabled by EIP-7702.
        vm.etch(customer, address(policy).code);
        vm.etch(vm.addr(VOUCHER_KEY), address(policy).code);
        assertEq(payments.collect(customer, channel, 100, signature), 100);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        assertEq(payee.balance, 100);
    }

    function testKeyWithCodeMayBeRegisteredAndUsedForDirectECDSA() public {
        uint256 fresh = payments.createChannel(payee, PERIOD);
        RejectingVoucherPolicy policy = new RejectingVoucherPolicy();
        vm.etch(vm.addr(VOUCHER_KEY), address(policy).code);
        vm.prank(customer);
        payments.registerVoucherKey(fresh, vm.addr(VOUCHER_KEY));
        _fund(customer, fresh, 50);
        assertEq(payments.collect(customer, fresh, 50, _sign(customer, fresh, 50)), 50);
    }

    function testKeyAndUnpaidVoucherSurviveWithdrawalAndRefill() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 100);
        vm.warp(_position(channel).readyAt);
        payments.withdraw(customer, channel);
        vm.prank(customer);
        vm.expectRevert(PayToPlay.VoucherKeyAlreadyRegistered.selector);
        payments.registerVoucherKey(channel, customer);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        _fund(customer, channel, 30);
        assertEq(payments.collect(customer, channel, 100, signature), 30);
        assertEq(_position(channel).voucherPaid, 30);
    }

    function testMoveDoesNotTransferOrResetVoucherKeys() public {
        uint256 fresh = payments.createChannel(payee, PERIOD);
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 100);
        vm.warp(_position(channel).readyAt);
        vm.prank(customer);
        payments.move(channel, fresh);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        assertEq(_position(fresh).voucherKey, address(0));
        vm.prank(customer);
        payments.registerVoucherKey(fresh, customer);
        vm.prank(customer);
        payments.requestWithdrawal(fresh, 100);
        vm.warp(_position(fresh).readyAt);
        vm.prank(customer);
        payments.move(fresh, channel);
        assertEq(_position(fresh).voucherKey, customer);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        assertEq(payments.collect(customer, channel, 100, _sign(customer, channel, 100)), 100);
    }

    function testInvalidSignaturesFailEvenWhenPaymentWouldBeZero() public {
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 0, hex"abcd");
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 100, new bytes(65));
        assertEq(payments.collect(customer, channel, 100, _sign(customer, channel, 100)), 0);
        _fund(customer, channel, 100);
        assertEq(payments.collect(customer, channel, 100, _sign(customer, channel, 100)), 100);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 100, hex"abcd");
        assertEq(_position(channel).voucherPaid, 100);
    }

    function testHighSSignatureIsRejectedWithoutStateChange() public {
        _fund(customer, channel, 100);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VOUCHER_KEY, payments.voucherDigest(customer, channel, 100));
        uint256 order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory signature = abi.encodePacked(r, bytes32(order - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 100, signature);
        assertEq(_position(channel).balance, 100);
        assertEq(_position(channel).voucherPaid, 0);
    }

    function testSignedTotalCannotBeChanged() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 50);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 100, signature);
        assertEq(payments.collect(customer, channel, 50, signature), 50);
    }
}
