pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract NativeCustomer {
    bool public rejectPayment;
    bool public reenter;
    bool public reentrySucceeded;
    bool public validSignature = true;
    PayToPlay private payments;
    uint256 private channel;

    function configure(PayToPlay app, uint256 id, bool reject, bool attack) external {
        payments = app;
        channel = id;
        rejectPayment = reject;
        reenter = attack;
    }

    function setSignatureValidity(bool valid) external {
        validSignature = valid;
    }

    function isValidSignature(bytes32, bytes calldata) external view returns (bytes4) {
        return validSignature ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }

    function registerVoucherKey(address voucherKey) external {
        payments.registerVoucherKey(channel, voucherKey);
    }

    function fund(uint256 amount) external {
        payments.fund{value: amount}(channel);
    }

    function request(uint256 amount) external {
        payments.requestWithdrawal(channel, amount);
    }

    receive() external payable {
        require(!rejectPayment, "fixture rejects native payment");
        if (reenter) {
            (reentrySucceeded,) = address(payments).call(abi.encodeCall(payments.withdraw, (address(this), channel)));
        }
    }
}

contract PayToPlayTest is PayToPlayTestBase {
    function testZeroPeriodIsImmediatelyMature() public {
        uint256 immediate = payments.createChannel(payee, 0);
        _fund(customer, immediate, 30);
        vm.prank(customer);
        payments.requestWithdrawal(immediate, 10);
        assertEq(_position(immediate).readyAt, block.timestamp);
        assertTrue(_hasAction(_position(immediate).actions, "withdraw"));
        assertEq(payments.withdraw(customer, immediate), 10);
    }

    function testWithdrawBeforeVoucherCollectionLeavesUnpaidVoucherPersistent() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 100);
        vm.warp(_position(channel).readyAt);
        payments.withdraw(customer, channel);
        assertEq(payments.collect(customer, channel, 100, signature), 0);
        assertEq(_position(channel).voucherPaid, 0);
        _fund(customer, channel, 20);
        assertEq(payments.collect(customer, channel, 100, signature), 20);
    }

    function testChannelsArePermanentAndOnlyPayeeChanges() public {
        assertEq(channel, 1);
        assertEq(otherChannel, 2);
        assertEq(payments.channelCount(), 3);
        PayToPlay.Channel memory definition = payments.channel(channel);
        assertEq(definition.claimPeriod, PERIOD);
        payments.setPayee(channel, relayer);
        assertEq(payments.channel(channel).payee, relayer);
        assertEq(payments.channel(channel).claimPeriod, PERIOD);
        vm.prank(relayer);
        vm.expectRevert(PayToPlay.AdminRequired.selector);
        payments.createChannel(payee, PERIOD);
        vm.expectRevert(PayToPlay.InvalidPayee.selector);
        payments.createChannel(address(0), PERIOD);
        vm.expectRevert(PayToPlay.NullChannelCannotCollect.selector);
        payments.setPayee(0, payee);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, 99));
        payments.channel(99);
    }

    function testVoucherPartialCollectionRetryAndFutureBacking() public {
        _fund(customer, channel, 30);
        bytes memory signature = _sign(customer, channel, 100);
        vm.prank(relayer);
        assertEq(payments.collect(customer, channel, 100, signature), 30);
        assertEq(_position(channel).voucherPaid, 30);
        assertEq(payee.balance, 30);
        assertEq(payments.collect(customer, channel, 100, signature), 0);
        _fund(customer, channel, 20);
        assertEq(payments.collect(customer, channel, 100, signature), 20);
        bytes memory oldSignature = _sign(customer, channel, 10);
        assertEq(payments.collect(customer, channel, 10, oldSignature), 0);
        assertEq(_position(channel).voucherPaid, 50);
    }

    function testOldVoucherUsesCurrentPayeeAndActualNotEffectiveBalance() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 50);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 100);
        assertEq(_position(channel).effectiveBalance, 0);
        payments.setPayee(channel, relayer);
        assertEq(payments.collect(customer, channel, 50, signature), 50);
        assertEq(payee.balance, 0);
        assertEq(relayer.balance, 50);
        assertEq(_position(channel).requestedAmount, 100);
    }

    function testWithdrawalPartialAndZeroConsumeRequest() public {
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 80);
        uint256 ready = _position(channel).readyAt;
        bytes memory signature = _sign(customer, channel, 60);
        payments.collect(customer, channel, 60, signature);
        assertEq(_position(channel).effectiveBalance, 0);
        vm.warp(ready - 1);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.WithdrawalNotReady.selector, ready));
        payments.withdraw(customer, channel);
        vm.warp(ready);
        vm.prank(relayer);
        assertEq(payments.withdraw(customer, channel), 40);
        assertEq(_position(channel).requestedAmount, 0);
        _fund(customer, channel, 50);
        vm.expectRevert(PayToPlay.WithdrawalNotRequested.selector);
        payments.withdraw(customer, channel);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 50);
        signature = _sign(customer, channel, 110);
        payments.collect(customer, channel, 110, signature);
        vm.warp(_position(channel).readyAt);
        assertEq(payments.withdraw(customer, channel), 0);
        assertEq(_position(channel).requestedAmount, 0);
        assertEq(_position(channel).voucherPaid, 110);
    }

    function testRequestRetryAndExplicitRenewal() public {
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 40);
        uint256 ready = _position(channel).readyAt;
        vm.warp(block.timestamp + 25);
        vm.prank(customer);
        payments.requestWithdrawal(channel, type(uint256).max);
        assertEq(_position(channel).readyAt, ready);
        vm.prank(customer);
        payments.setWithdrawal(channel, 100);
        assertEq(_position(channel).readyAt, block.timestamp + PERIOD);
        assertEq(_position(channel).requestedAmount, 100);
        bytes memory signature = _sign(customer, channel, 50);
        payments.collect(customer, channel, 50, signature);
        _fund(customer, channel, 20);
        assertEq(_position(channel).readyAt, block.timestamp + PERIOD);
        assertEq(_position(channel).effectiveBalance, 0);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.InvalidWithdrawalAmount.selector, 0, 0));
        payments.setWithdrawal(channel, 0);
        assertFalse(_hasAction(payments.viewPosition(customer, channel, address(this)).actions, "setWithdrawal"));
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.InvalidWithdrawalAmount.selector, 0, 0));
        payments.requestWithdrawal(channel, 0);
    }

    function testOnlyCallerPositionCanBeRequested() public {
        _fund(customer, channel, 50);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.InvalidWithdrawalAmount.selector, 1, 0));
        payments.requestWithdrawal(channel, 1);
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.InvalidWithdrawalAmount.selector, 1, 0));
        payments.setWithdrawal(channel, 1);
        assertEq(_position(channel).requestedAmount, 0);
        assertTrue(_hasAction(_position(channel).actions, "requestWithdrawal"));
        PayToPlay.PositionView memory otherActor = payments.viewPosition(customer, channel, relayer);
        assertFalse(_hasAction(otherActor.actions, "requestWithdrawal"));
        assertFalse(_hasAction(otherActor.actions, "setWithdrawal"));
        assertFalse(_hasAction(otherActor.actions, "fund"));
    }

    function testNullMovementHasSameWaitAndConsumesRequest() public {
        _fund(customer, 0, 100);
        vm.prank(customer);
        payments.requestWithdrawal(0, 80);
        uint256 ready = _position(0).readyAt;
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.WithdrawalNotReady.selector, ready));
        payments.move(0, channel);
        vm.warp(_position(0).readyAt);
        vm.prank(customer);
        vm.expectRevert(PayToPlay.SameChannel.selector);
        payments.move(0, 0);
        vm.prank(customer);
        assertEq(payments.move(0, channel), 80);
        assertEq(_position(0).balance, 20);
        assertEq(_position(channel).balance, 80);
        assertEq(_position(0).requestedAmount, 0);
        bytes memory signature = _sign(customer, 0, 1);
        vm.expectRevert(PayToPlay.NullChannelCannotCollect.selector);
        payments.collect(customer, 0, 1, signature);
    }

    function testVoucherCannotReplayAcrossCustomerChannelContractOrChain() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 50);
        vm.prank(relayer);
        payments.registerVoucherKey(channel, vm.addr(VOUCHER_KEY));
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(relayer, channel, 50, signature);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, otherChannel, 50, signature);
        PayToPlay other = new PayToPlay(address(this), PERIOD);
        other.createChannel(payee, PERIOD);
        vm.prank(customer);
        other.registerVoucherKey(channel, vm.addr(VOUCHER_KEY));
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        other.collect(customer, channel, 50, signature);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 50, signature);
    }

    function testContractWalletPolicyCannotRevokeRegisteredKeyVouchers() public {
        NativeCustomer wallet = new NativeCustomer();
        wallet.configure(payments, channel, false, false);
        wallet.registerVoucherKey(vm.addr(VOUCHER_KEY));
        _fund(address(wallet), channel, 50);
        bytes memory signature = _sign(address(wallet), channel, 100);
        wallet.setSignatureValidity(false);
        assertEq(payments.collect(address(wallet), channel, 100, signature), 50);
        wallet.setSignatureValidity(true);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(address(wallet), channel, 100, hex"abcd");
        wallet.setSignatureValidity(false);
        _fund(address(wallet), channel, 50);
        assertEq(payments.collect(address(wallet), channel, 100, signature), 50);
        assertEq(payments.collect(address(wallet), channel, 100, signature), 0);
    }

    function testNativeRejectionRollsBackPaidAndWithdrawalRequest() public {
        NativeCustomer wallet = new NativeCustomer();
        wallet.configure(payments, channel, true, false);
        _fund(address(wallet), channel, 50);
        wallet.request(50);
        uint256 ready = payments.viewPosition(address(wallet), channel, address(wallet)).readyAt;
        vm.warp(ready);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.NativePaymentFailed.selector, address(wallet), 50));
        payments.withdraw(address(wallet), channel);
        assertEq(payments.viewPosition(address(wallet), channel, address(wallet)).requestedAmount, 50);
        payments.setPayee(channel, address(wallet));
        bytes memory signature = _sign(customer, channel, 50);
        _fund(customer, channel, 50);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.NativePaymentFailed.selector, address(wallet), 50));
        payments.collect(customer, channel, 50, signature);
        assertEq(_position(channel).voucherPaid, 0);
        assertEq(_position(channel).balance, 50);
    }

    function testNativeCallbackCannotConsumeWithdrawalTwice() public {
        NativeCustomer wallet = new NativeCustomer();
        wallet.configure(payments, channel, false, true);
        _fund(address(wallet), channel, 50);
        wallet.request(50);
        vm.warp(payments.viewPosition(address(wallet), channel, address(wallet)).readyAt);
        payments.withdraw(address(wallet), channel);
        assertFalse(wallet.reentrySucceeded());
        assertEq(address(wallet).balance, 50);
        assertEq(payments.viewPosition(address(wallet), channel, address(wallet)).balance, 0);
    }

    function testUncreditedNativeTransfersAndUndefinedPositionsFail() public {
        vm.deal(address(this), 10);
        (bool accepted,) = address(payments).call{value: 1}("");
        assertFalse(accepted);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, 99));
        payments.fund{value: 1}(99);
        assertEq(address(payments).balance, 0);
    }
}
