pragma solidity 0.8.35;

import {Vm} from "forge-std-1.12.0/src/Test.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

/// @dev Note 022: fresh credits restart an existing request, not the voucher stream.
contract PayToPlayWithdrawalFundingTest is PayToPlayTestBase {
    address private collector;
    bytes32 private constant REQUEST_EVENT = keccak256("WithdrawalRequested(address,uint256,uint256,uint256)");

    function setUp() public override {
        super.setUp();
        vm.warp(10_000);
        collector = makeAddr("credit-window collector");
        payments.setCollector(channel, collector);
        payments.setCollector(otherChannel, collector);
    }

    function testMatureRequestCannotRemoveReplenishedBackingBeforeCollection() public {
        _fund(customer, channel, 100);
        _request(channel, 100);
        uint256 originalReady = _position(channel).readyAt;
        vm.warp(originalReady - 1);
        _collect(channel, 100, 100);
        assertEq(_position(channel).balance, 0);
        assertEq(_position(channel).requestedAmount, 100);

        vm.warp(originalReady + 40);
        uint256 restarted = block.timestamp + PERIOD;
        vm.recordLogs();
        _fund(customer, channel, 100);
        _assertRequest(channel, 100, restarted);
        _assertRestart(vm.getRecordedLogs(), channel, 100, restarted);
        assertEq(_position(channel).voucherPaid, 100);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        assertEq(_position(channel).effectiveBalance, 0, "a restarted request is still excluded from backing");

        vm.warp(restarted - 1);
        _assertNoEarlyExit(channel, otherChannel, restarted);
        _collect(channel, 180, 80);
        assertEq(_position(channel).balance, 20);
        _assertRequest(channel, 100, restarted);
        vm.warp(restarted);
        assertTrue(_hasAction(_position(channel).actions, "move"));
        assertTrue(_hasAction(payments.viewPosition(customer, channel, relayer).actions, "withdraw"));
        assertFalse(_hasAction(payments.viewPosition(customer, channel, relayer).actions, "move"));
        uint256 customerBefore = customer.balance;
        vm.prank(relayer);
        assertEq(payments.withdraw(customer, channel), 20);
        assertEq(customer.balance, customerBefore + 20);
        _assertRequest(channel, 0, 0);
        assertEq(payee.balance, 180);
        assertEq(_position(channel).voucherPaid, 180);
        assertEq(payments.channel(channel).escrowTotal, 0);
        assertEq(address(payments).balance, 0);
    }

    function testOneWeiRestartsImmatureRequestAndRepeatedCreditsDoNotAccumulatePeriods() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        uint256 start = block.timestamp;
        vm.warp(start + 30);
        _fund(customer, channel, 1);
        _assertRequest(channel, 80, start + 30 + PERIOD);
        vm.warp(start + 50);
        for (uint256 i; i < 2; i++) {
            vm.recordLogs();
            _fund(customer, channel, 1);
            _assertRequest(channel, 80, start + 50 + PERIOD);
            _assertRestart(vm.getRecordedLogs(), channel, 80, start + 50 + PERIOD);
        }
        assertEq(_position(channel).balance, 103);
        vm.warp(start + 50 + PERIOD);
        assertEq(payments.withdraw(customer, channel), 80, "older funds share the restarted wait");
        assertEq(_position(channel).balance, 23);
    }

    function testPositiveFundingPreservesARequestLargerThanTheNewBalance() public {
        _fund(customer, channel, 100);
        _request(channel, 100);
        _collect(channel, 100, 100);
        vm.warp(block.timestamp + PERIOD + 1);
        _fund(customer, channel, 20);
        _assertRequest(channel, 100, block.timestamp + PERIOD);
        assertEq(_position(channel).balance, 20);
        assertEq(_position(channel).effectiveBalance, 0);
    }

    function testReserveFundingAlsoRestartsTheWholeRequest() public {
        _fund(customer, 0, 100);
        _request(0, 100);
        vm.warp(block.timestamp + PERIOD + 1);
        vm.recordLogs();
        _fund(customer, 0, 1);
        _assertRequest(0, 100, block.timestamp + PERIOD);
        _assertRestart(vm.getRecordedLogs(), 0, 100, block.timestamp + PERIOD);
        _assertNoEarlyExit(0, channel, block.timestamp + PERIOD);
    }

    function testZeroFundingDoesNotRestartAndFundingWithoutRequestCreatesNone() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        uint256 ready = _position(channel).readyAt;
        uint256 recovery = _position(channel).refundAt;
        vm.warp(ready + 1);
        vm.recordLogs();
        _fund(customer, channel, 0);
        assertEq(vm.getRecordedLogs().length, 0);
        _assertRequest(channel, 80, ready);
        assertEq(_position(channel).refundAt, recovery);
        vm.recordLogs();
        _fund(customer, otherChannel, 10);
        _assertNoRestart(vm.getRecordedLogs());
        _assertRequest(otherChannel, 0, 0);
        assertEq(payments.withdraw(customer, channel), 80);
    }

    function testZeroPeriodCreditStillPublishesAnImmediatelyExecutableRequest() public {
        uint256 immediate = payments.createChannel(payee, collector, 0);
        _fund(customer, immediate, 50);
        _request(immediate, 30);
        vm.warp(block.timestamp + 10);
        vm.recordLogs();
        _fund(customer, immediate, 1);
        _assertRequest(immediate, 30, block.timestamp);
        _assertRestart(vm.getRecordedLogs(), immediate, 30, block.timestamp);
        assertEq(payments.withdraw(customer, immediate), 30);
        assertEq(_position(immediate).balance, 21);
    }

    function testMoveFromZeroPeriodUsesTheLongerDestinationWait() public {
        _assertIncomingMove(payments.createChannel(payee, collector, 0), channel);
    }

    function testMoveFromLongPeriodUsesTheShorterDestinationWait() public {
        _assertIncomingMove(payments.createChannel(payee, collector, 3 * PERIOD), channel);
    }

    function testMoveFromReserveRestartsDestinationRequest() public {
        _assertIncomingMove(0, channel);
    }

    function testMoveIntoReserveRestartsReserveRequest() public {
        _assertIncomingMove(payments.createChannel(payee, collector, 0), 0);
    }

    function testZeroMoveConsumesSourceWithoutTouchingDestinationRequest() public {
        _fund(customer, channel, 10);
        _request(channel, 10);
        _collect(channel, 10, 10);
        _fund(customer, otherChannel, 50);
        _request(otherChannel, 40);
        vm.warp(block.timestamp + PERIOD + 1);
        bytes32 beforeDestination = keccak256(abi.encode(_position(otherChannel)));
        vm.recordLogs();
        vm.prank(customer);
        assertEq(payments.move(channel, otherChannel), 0);
        _assertNoRestart(vm.getRecordedLogs());
        _assertRequest(channel, 0, 0);
        assertEq(keccak256(abi.encode(_position(otherChannel))), beforeDestination);
        assertEq(address(payments).balance, 50);
    }

    function testPositiveMoveWithoutDestinationRequestCreatesNone() public {
        _fund(customer, channel, 10);
        _request(channel, 10);
        vm.warp(block.timestamp + PERIOD);
        vm.recordLogs();
        vm.prank(customer);
        assertEq(payments.move(channel, otherChannel), 10);
        _assertNoRestart(vm.getRecordedLogs());
        _assertRequest(channel, 0, 0);
        _assertRequest(otherChannel, 0, 0);
        assertEq(_position(otherChannel).balance, 10);
        assertEq(_position(otherChannel).refundAt, block.timestamp + payments.RECOVERY_HORIZON() + PERIOD);
    }

    function testRecoveryRenewalAtTheSameTimestampCannotSuppressCreditRestart() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        uint256 ready = _position(channel).readyAt;
        vm.warp(ready + 10);
        vm.prank(customer);
        payments.renewPosition(channel);
        _assertRequest(channel, 80, ready);
        uint256 renewedRecovery = _position(channel).refundAt;
        vm.recordLogs();
        _fund(customer, channel, 1);
        _assertRequest(channel, 80, block.timestamp + PERIOD);
        _assertRestart(vm.getRecordedLogs(), channel, 80, block.timestamp + PERIOD);
        assertEq(_position(channel).refundAt, renewedRecovery, "ordinary restart is independent of _renew's no-op");
    }

    function testOtherCustomersCannotRestartTheOwnersRequest() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        uint256 ready = _position(channel).readyAt;
        vm.warp(block.timestamp + 30);
        _fund(relayer, channel, 10);
        vm.prank(relayer);
        payments.requestWithdrawal(channel, 10);
        vm.warp(ready + 30);
        vm.prank(relayer);
        assertEq(payments.move(channel, otherChannel), 10);
        _assertRequest(channel, 80, ready);
        assertEq(_position(channel).balance, 100);
        assertEq(_position(otherChannel).balance, 0);
        assertEq(payments.withdraw(customer, channel), 80);
    }

    function testCollectionReplayRenewalAndRecipientChangesDoNotProlongExit() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        uint256 ready = _position(channel).readyAt;
        vm.warp(block.timestamp + 30);
        _collect(channel, 20, 20);
        vm.recordLogs();
        _collect(channel, 100, 0);
        _collect(channel, 20, 20);
        assertEq(vm.getRecordedLogs().length, 0, "zero payments create no payment or restart event");
        vm.startPrank(customer);
        payments.renewPosition(channel);
        payments.setRefundRecipient(channel, relayer);
        vm.stopPrank();
        _assertRequest(channel, 80, ready);
        vm.warp(ready);
        uint256 customerBefore = customer.balance;
        uint256 recipientBefore = relayer.balance;
        assertEq(payments.withdraw(customer, channel), 80);
        assertEq(customer.balance, customerBefore + 80);
        assertEq(relayer.balance, recipientBefore, "ordinary withdrawal still pays the owner");
    }

    function testFailedFundingPreservesBalanceAndBothDeadlines() public {
        _fund(customer, channel, 100);
        _request(channel, 80);
        vm.warp(block.timestamp + 20);
        bytes32 beforePosition = keccak256(abi.encode(_position(channel)));
        vm.deal(customer, 1);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.FundingValueMismatch.selector, 2, 1));
        payments.fund{value: 1}(channel, 2);
        assertEq(keccak256(abi.encode(_position(channel))), beforePosition);
        assertEq(customer.balance, 1);
        assertEq(address(payments).balance, 100);
    }

    function _assertIncomingMove(uint256 source, uint256 target) private {
        _fund(customer, source, 40);
        _request(source, 40);
        _fund(customer, target, 100);
        _request(target, 100);
        if (target != 0) _collect(target, 100, 100);
        uint256 targetBalance = target == 0 ? 140 : 40;
        uint256 sourceWait = payments.channel(source).claimPeriod;
        uint256 targetWait = payments.channel(target).claimPeriod;
        vm.warp(block.timestamp + sourceWait + targetWait + 1);
        uint256 contractBalance = address(payments).balance;
        uint256 restarted = block.timestamp + targetWait;
        vm.recordLogs();
        vm.prank(customer);
        assertEq(payments.move(source, target), 40);
        _assertRequest(source, 0, 0);
        _assertRequest(target, 100, restarted);
        _assertRestart(vm.getRecordedLogs(), target, 100, restarted);
        assertEq(_position(target).balance, targetBalance);
        assertEq(payments.channel(source).escrowTotal, 0);
        assertEq(payments.channel(target).escrowTotal, targetBalance);
        assertEq(address(payments).balance, contractBalance, "move changes no aggregate backing");
        vm.warp(restarted - 1);
        _assertNoEarlyExit(target, source, restarted);
        vm.warp(restarted);
        vm.prank(customer);
        assertEq(payments.move(target, source), target == 0 ? 100 : 40);
        _assertRequest(target, 0, 0);
    }

    function _request(uint256 id, uint256 amount) private {
        vm.prank(customer);
        payments.requestWithdrawal(id, amount);
    }

    function _collect(uint256 id, uint256 total, uint256 cap) private {
        bytes memory signature = _sign(customer, id, total);
        vm.prank(collector);
        payments.collect(customer, id, total, INVOICE_HASH, cap, signature);
    }

    function _assertRequest(uint256 id, uint256 amount, uint256 ready) private view {
        PayToPlay.PositionView memory position = _position(id);
        assertEq(position.requestedAmount, amount, "preserve or consume the whole request");
        assertEq(position.readyAt, ready, "positive credit starts a fresh period from this block");
    }

    function _assertNoEarlyExit(uint256 id, uint256 target, uint256 ready) private {
        bytes32 beforePosition = keccak256(abi.encode(_position(id)));
        assertFalse(_hasAction(_position(id).actions, "withdraw"));
        assertFalse(_hasAction(_position(id).actions, "move"));
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.WithdrawalNotReady.selector, ready));
        payments.withdraw(customer, id);
        vm.prank(customer);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.WithdrawalNotReady.selector, ready));
        payments.move(id, target);
        assertEq(keccak256(abi.encode(_position(id))), beforePosition);
    }

    function _assertRestart(Vm.Log[] memory logs, uint256 id, uint256 amount, uint256 ready) private view {
        uint256 count;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(payments) || logs[i].topics[0] != REQUEST_EVENT) continue;
            count++;
            assertEq(logs[i].topics.length, 3);
            assertEq(logs[i].topics[1], bytes32(uint256(uint160(customer))));
            assertEq(logs[i].topics[2], bytes32(id));
            (uint256 emittedAmount, uint256 emittedReady) = abi.decode(logs[i].data, (uint256, uint256));
            assertEq(emittedAmount, amount);
            assertEq(emittedReady, ready);
        }
        assertEq(count, 1, "publish exactly one restart per positive credit to an existing request");
    }

    function _assertNoRestart(Vm.Log[] memory logs) private view {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(payments)) assertTrue(logs[i].topics[0] != REQUEST_EVENT);
        }
    }
}
