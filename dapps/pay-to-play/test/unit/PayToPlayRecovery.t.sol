pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract RecoveryRecipient {
    bool public reject = true;
    bool public attack;
    bool public reentered;
    PayToPlay private payments;
    address private customer;
    uint256 private channelId;

    function configure(PayToPlay app, address account, uint256 id, bool reject_, bool attack_) external {
        payments = app;
        customer = account;
        channelId = id;
        reject = reject_;
        attack = attack_;
    }

    receive() external payable {
        require(!reject, "fixture rejects refund");
        if (attack) {
            (reentered,) = address(payments).call(abi.encodeCall(payments.refund, (customer, channelId)));
        }
    }
}

contract PayToPlayRecoveryTest is PayToPlayTestBase {
    function testFirstFundingStartsAnnualHorizonButRegistrationAndZeroFundingDoNot() public {
        assertEq(_position(channel).refundAt, 0);
        _fund(customer, channel, 0);
        assertEq(_position(channel).refundAt, 0);
        _fund(customer, channel, 100);
        PayToPlay.PositionView memory position = _position(channel);
        assertEq(position.settleAt, block.timestamp + 365 days);
        assertEq(position.refundAt, block.timestamp + 365 days + PERIOD);
        assertEq(position.scheduledRefundAt, position.refundAt);
        assertEq(position.refundRecipient, customer);
        assertEq(payments.channel(channel).escrowTotal, 100);
    }

    function testAnnualBoundaryStopsRenewalAndFundingButPreservesFinalCollectionWindow() public {
        _fund(customer, channel, 100);
        uint256 start = _position(channel).settleAt;
        uint256 deadline = _position(channel).refundAt;
        bytes memory signature = _sign(customer, channel, 30);
        vm.warp(start - 1);
        assertEq(uint256(_position(channel).phase), uint256(PayToPlay.Phase.Operating));
        vm.warp(start);
        assertEq(uint256(_position(channel).phase), uint256(PayToPlay.Phase.Settling));
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.renewPosition(channel);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.fund(channel);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.setWithdrawal(channel, 10);
        vm.stopPrank();
        assertEq(payments.collect(customer, channel, 30, signature), 30);
        vm.warp(deadline - 1);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.RefundNotReady.selector, deadline));
        payments.refund(customer, channel);
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.VoucherCollectionEnded.selector, deadline));
        payments.collect(customer, channel, 30, signature);
        uint256 before = customer.balance;
        vm.prank(relayer);
        assertEq(payments.refund(customer, channel), 70);
        assertEq(customer.balance, before + 70);
        assertEq(payments.channel(channel).escrowTotal, 0);
    }

    function testOnlyOwnerCanRenewAndRenewalPreservesWithdrawal() public {
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 50);
        uint256 ready = _position(channel).readyAt;
        uint256 oldDeadline = _position(channel).refundAt;
        vm.warp(block.timestamp + 10);
        vm.prank(payee);
        vm.expectRevert(PayToPlay.RecoveryNotScheduled.selector);
        payments.renewPosition(channel);
        vm.prank(customer);
        payments.renewPosition(channel);
        assertEq(_position(channel).refundAt, oldDeadline + 10);
        assertEq(_position(channel).readyAt, ready);
        assertEq(_position(channel).requestedAmount, 50);
    }

    function testPositiveFundingRenewsButCollectionsAndZeroFundingDoNot() public {
        _fund(customer, channel, 100);
        uint256 first = _position(channel).refundAt;
        vm.warp(block.timestamp + 10);
        _fund(customer, channel, 0);
        payments.collect(customer, channel, 10, _sign(customer, channel, 10));
        assertEq(_position(channel).refundAt, first);
        _fund(customer, channel, 1);
        assertEq(_position(channel).refundAt, first + 10);
        assertEq(payments.channel(channel).escrowTotal, 91);
    }

    function testConsumerAdminAndPayeeCanCloseOnlyTheSelectedPosition() public {
        _fund(customer, channel, 100);
        _fund(customer, otherChannel, 100);
        _fund(relayer, channel, 100);
        vm.prank(relayer);
        vm.expectRevert(PayToPlay.ClosureAuthorityRequired.selector);
        payments.closePosition(customer, channel);
        vm.prank(payee);
        payments.closePosition(customer, channel);
        assertEq(_position(channel).refundAt, block.timestamp + PERIOD);
        assertEq(uint256(_position(channel).phase), uint256(PayToPlay.Phase.Settling));
        assertEq(uint256(_position(otherChannel).phase), uint256(PayToPlay.Phase.Operating));
        assertEq(uint256(payments.viewPosition(relayer, channel, relayer).phase), uint256(PayToPlay.Phase.Operating));
        vm.prank(customer);
        payments.closePosition(customer, otherChannel);
        payments.closePosition(relayer, channel);
        assertEq(payments.viewPosition(relayer, channel, relayer).refundAt, block.timestamp + PERIOD);
    }

    function testRepeatedClosureCannotPostponeAnnualOrEarlyDeadline() public {
        _fund(customer, channel, 100);
        payments.closePosition(customer, channel);
        uint256 deadline = _position(channel).refundAt;
        vm.warp(block.timestamp + 20);
        vm.prank(payee);
        payments.closePosition(customer, channel);
        payments.closeChannel(channel);
        assertEq(_position(channel).refundAt, deadline);
        uint256 closeAt = payments.channel(channel).closeAt;
        vm.warp(closeAt + 1);
        payments.closeChannel(channel);
        payments.closePosition(customer, channel);
        assertEq(payments.channel(channel).closeAt, closeAt);
        assertEq(_position(channel).refundAt, deadline);
    }

    function testClosingDuringAnnualSettlementDoesNotRestartIt() public {
        _fund(customer, channel, 100);
        uint256 deadline = _position(channel).refundAt;
        vm.warp(deadline - 1);
        payments.closePosition(customer, channel);
        payments.closeChannel(channel);
        assertEq(_position(channel).refundAt, deadline);
        vm.warp(deadline);
        assertEq(payments.refund(customer, channel), 100);
    }

    function testEarlierWithdrawalRemainsExecutableDuringChannelSettlement() public {
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 40);
        uint256 ready = _position(channel).readyAt;
        vm.warp(block.timestamp + 10);
        payments.closeChannel(channel);
        assertEq(_position(channel).readyAt, ready);
        vm.warp(ready);
        assertEq(payments.withdraw(customer, channel), 40);
        assertEq(_position(channel).balance, 60);
        vm.warp(payments.channel(channel).closeAt);
        assertEq(payments.refund(customer, channel), 60);
    }

    function testChannelClosureStopsAllIncomingValueButDoesNotBlockExistingOutgoingMove() public {
        _fund(customer, channel, 100);
        _fund(customer, otherChannel, 20);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 50);
        uint256 ready = _position(channel).readyAt;
        payments.closeChannel(channel);
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.fund(channel);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.renewPosition(channel);
        payments.requestWithdrawal(otherChannel, 20);
        vm.stopPrank();
        vm.warp(ready);
        vm.prank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.move(otherChannel, channel);
        assertEq(_position(otherChannel).requestedAmount, 20, "failed move preserves its source request");
        vm.prank(customer);
        assertEq(payments.move(channel, otherChannel), 50);
        assertEq(payments.channel(channel).escrowTotal, 50);
        assertEq(payments.channel(otherChannel).escrowTotal, 70);
    }

    function testMoveRenewsTargetButZeroMoveDoesNot() public {
        _fund(customer, channel, 10);
        _fund(customer, otherChannel, 10);
        uint256 before = _position(otherChannel).refundAt;
        vm.prank(customer);
        payments.requestWithdrawal(channel, 10);
        payments.collect(customer, channel, 10, _sign(customer, channel, 10));
        vm.warp(_position(channel).readyAt);
        vm.prank(customer);
        assertEq(payments.move(channel, otherChannel), 0);
        assertEq(_position(otherChannel).refundAt, before);
        _fund(customer, channel, 10);
        vm.prank(customer);
        payments.requestWithdrawal(channel, 10);
        vm.warp(_position(channel).readyAt);
        vm.prank(customer);
        assertEq(payments.move(channel, otherChannel), 10);
        assertEq(_position(otherChannel).refundAt, block.timestamp + 365 days + PERIOD);
        assertEq(payments.channel(channel).escrowTotal, 0);
        assertEq(payments.channel(otherChannel).escrowTotal, 20);
    }

    function testRefundClearsCycleAndRequestsButNeverKeyOrPaidTotal() public {
        _fund(customer, channel, 100);
        bytes memory voucher = _sign(customer, channel, 100);
        payments.collect(customer, channel, 20, _sign(customer, channel, 20));
        vm.prank(customer);
        payments.requestWithdrawal(channel, 40);
        payments.closePosition(customer, channel);
        vm.warp(_position(channel).refundAt);
        assertEq(payments.refund(customer, channel), 80);
        PayToPlay.PositionView memory position = _position(channel);
        assertEq(position.scheduledRefundAt, 0);
        assertEq(position.requestedAmount, 0);
        assertEq(position.readyAt, 0);
        assertEq(position.voucherPaid, 20);
        assertEq(position.voucherKey, vm.addr(VOUCHER_KEY));
        _fund(customer, channel, 30);
        assertEq(_position(channel).settleAt, block.timestamp + 365 days);
        vm.expectRevert(PayToPlay.WithdrawalNotRequested.selector);
        payments.withdraw(customer, channel);
        assertEq(payments.collect(customer, channel, 100, voucher), 30);
        assertEq(_position(channel).voucherPaid, 50);
    }

    function testEmptyBalanceDoesNotBypassSettlementAndZeroRefundEndsTheCycle() public {
        _fund(customer, channel, 100);
        payments.closePosition(customer, channel);
        payments.collect(customer, channel, 100, _sign(customer, channel, 100));
        vm.prank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.fund(channel);
        vm.warp(_position(channel).refundAt);
        assertTrue(_hasAction(_position(channel).actions, "refund"));
        assertEq(payments.refund(customer, channel), 0);
        _fund(customer, channel, 10);
        assertEq(_position(channel).balance, 10);
        assertEq(_position(channel).voucherPaid, 100);
    }

    function testClosedChannelNeverReopensEvenAfterAllRefunds() public {
        _fund(customer, channel, 100);
        vm.prank(payee);
        payments.closeChannel(channel);
        uint256 deadline = payments.channel(channel).closeAt;
        vm.warp(deadline);
        payments.refund(customer, channel);
        assertEq(payments.channel(channel).escrowTotal, 0);
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.fund(channel);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.renewPosition(channel);
        vm.stopPrank();
        vm.prank(relayer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.registerVoucherKey(channel, relayer);
        bytes memory signature = _sign(customer, channel, 100);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.VoucherCollectionEnded.selector, deadline));
        payments.collect(customer, channel, 100, signature);
        vm.expectRevert(PayToPlay.ChannelClosed.selector);
        payments.setPayee(channel, relayer);
        assertEq(payments.refund(customer, channel), 0, "closed-channel refund retry cannot pay twice");
    }

    function testPayeeReplacementDuringSettlementDoesNotChangeDeadlineOrRefundDestination() public {
        _fund(customer, channel, 100);
        payments.closeChannel(channel);
        uint256 deadline = payments.channel(channel).closeAt;
        payments.setPayee(channel, relayer);
        assertEq(payments.channel(channel).closeAt, deadline);
        assertEq(_position(channel).refundRecipient, customer);
        assertEq(payments.collect(customer, channel, 30, _sign(customer, channel, 30)), 30);
        assertEq(relayer.balance, 30);
        vm.warp(deadline);
        uint256 before = customer.balance;
        payments.refund(customer, channel);
        assertEq(customer.balance, before + 70);
    }

    function testOnlyCurrentPayeeOrAdminCanCloseChannelIncludingNullRules() public {
        vm.prank(customer);
        vm.expectRevert(PayToPlay.ClosureAuthorityRequired.selector);
        payments.closeChannel(channel);
        payments.setPayee(channel, relayer);
        vm.prank(payee);
        vm.expectRevert(PayToPlay.ClosureAuthorityRequired.selector);
        payments.closeChannel(channel);
        vm.prank(relayer);
        payments.closeChannel(channel);
        vm.prank(relayer);
        vm.expectRevert(PayToPlay.ClosureAuthorityRequired.selector);
        payments.closeChannel(0);
        _fund(customer, 0, 50);
        payments.closeChannel(0);
        vm.warp(payments.channel(0).closeAt);
        assertEq(payments.refund(customer, 0), 50);
    }

    function testClaimPeriodCapAppliesToConstructorAndChannelCreation() public {
        uint64 maximum = payments.MAX_CLAIM_PERIOD();
        payments.createChannel(payee, maximum);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ClaimPeriodTooLong.selector, maximum + 1));
        payments.createChannel(payee, maximum + 1);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ClaimPeriodTooLong.selector, maximum + 1));
        new PayToPlay(address(this), maximum + 1);
    }

    function testZeroClaimPeriodMakesEarlyClosureImmediatelyRefundOnly() public {
        uint256 immediate = payments.createChannel(payee, 0);
        _fund(customer, immediate, 20);
        payments.closePosition(customer, immediate);
        assertEq(uint256(_position(immediate).phase), uint256(PayToPlay.Phase.RefundOnly));
        assertEq(payments.refund(customer, immediate), 20);
        _fund(customer, immediate, 10);
        payments.closeChannel(immediate);
        assertEq(payments.refund(customer, immediate), 10);
        vm.prank(customer);
        vm.expectRevert(PayToPlay.PositionNotOperating.selector);
        payments.fund(immediate);
    }

    function testRefundRecipientIsOwnerScopedAndCannotChangeDeadlines() public {
        _fund(customer, channel, 100);
        uint256 deadline = _position(channel).refundAt;
        payments.setRefundRecipient(channel, payee);
        vm.prank(payee);
        payments.setRefundRecipient(channel, payee);
        vm.prank(vm.addr(VOUCHER_KEY));
        payments.setRefundRecipient(channel, payee);
        assertEq(_position(channel).refundRecipient, customer);
        vm.prank(customer);
        payments.setRefundRecipient(channel, relayer);
        assertEq(_position(channel).refundAt, deadline);
        payments.closePosition(customer, channel);
        vm.warp(_position(channel).refundAt);
        uint256 before = relayer.balance;
        payments.refund(customer, channel);
        assertEq(relayer.balance, before + 100);
        assertEq(_position(channel).refundRecipient, relayer);
    }

    function testInvalidRefundRecipientsAreRejected() public {
        vm.startPrank(customer);
        vm.expectRevert(PayToPlay.InvalidRefundRecipient.selector);
        payments.setRefundRecipient(channel, address(0));
        vm.expectRevert(PayToPlay.InvalidRefundRecipient.selector);
        payments.setRefundRecipient(channel, address(payments));
        vm.stopPrank();
    }

    function testFailingRecipientDoesNotEraseEntitlementOrBlockOtherCustomers() public {
        RecoveryRecipient rejector = new RecoveryRecipient();
        _fund(customer, channel, 100);
        _fund(relayer, channel, 20);
        vm.prank(customer);
        payments.setRefundRecipient(channel, address(rejector));
        payments.closeChannel(channel);
        uint256 deadline = payments.channel(channel).closeAt;
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.NativePaymentFailed.selector, address(rejector), 100));
        payments.refund(customer, channel);
        assertEq(_position(channel).balance, 100);
        assertEq(_position(channel).refundAt, deadline);
        assertEq(payments.channel(channel).escrowTotal, 120);
        assertEq(payments.refund(relayer, channel), 20);
        assertEq(payments.channel(channel).escrowTotal, 100);
        vm.prank(customer);
        payments.setRefundRecipient(channel, customer);
        assertEq(payments.refund(customer, channel), 100);
        assertEq(payments.channel(channel).escrowTotal, 0);
    }

    function testRefundCallbackCannotDoubleConsume() public {
        RecoveryRecipient recipient = new RecoveryRecipient();
        recipient.configure(payments, customer, channel, false, true);
        _fund(customer, channel, 100);
        vm.prank(customer);
        payments.setRefundRecipient(channel, address(recipient));
        payments.closePosition(customer, channel);
        vm.warp(_position(channel).refundAt);
        assertEq(payments.refund(customer, channel), 100);
        assertFalse(recipient.reentered());
        assertEq(address(recipient).balance, 100);
        assertEq(_position(channel).balance, 0);
        assertEq(payments.channel(channel).escrowTotal, 0);
    }

    function testUnfundedRefundAndUnknownChannelsFailWithoutCreatingCycles() public {
        payments.closePosition(customer, channel);
        assertEq(_position(channel).refundAt, 0);
        vm.expectRevert(PayToPlay.RecoveryNotScheduled.selector);
        payments.refund(customer, channel);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, 99));
        payments.closeChannel(99);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, 99));
        payments.refund(customer, 99);
    }

    function testActionsFollowTimeWithoutAFinalizationTransaction() public {
        _fund(customer, channel, 100);
        assertTrue(_hasAction(_position(channel).actions, "renewPosition"));
        assertTrue(_hasAction(payments.viewPosition(customer, channel, payee).actions, "closePosition"));
        assertFalse(_hasAction(payments.viewPosition(customer, channel, relayer).actions, "closePosition"));
        payments.closeChannel(channel);
        assertFalse(_hasAction(_position(channel).actions, "fund"));
        assertFalse(_hasAction(_position(channel).actions, "renewPosition"));
        assertTrue(_hasAction(_position(channel).actions, "collect"));
        vm.warp(payments.channel(channel).closeAt);
        assertTrue(_hasAction(payments.viewPosition(customer, channel, relayer).actions, "refund"));
        assertFalse(_hasAction(_position(channel).actions, "collect"));
        assertTrue(_hasAction(_position(channel).actions, "setRefundRecipient"));
    }

    function testChannelClosureGasDoesNotScaleWithItsCustomers() public {
        uint256 populated = payments.createChannel(payee, PERIOD);
        uint256 empty = payments.createChannel(payee, PERIOD);
        for (uint256 i = 1; i <= 32; i++) _fund(address(uint160(1000 + i)), populated, 1);
        uint256 before = gasleft();
        payments.closeChannel(empty);
        uint256 emptyCost = before - gasleft();
        before = gasleft();
        payments.closeChannel(populated);
        uint256 populatedCost = before - gasleft();
        assertLt(populatedCost, emptyCost + 15_000);
        assertEq(payments.channel(populated).escrowTotal, 32);
    }

}
