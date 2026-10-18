pragma solidity 0.8.35;

import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract PayToPlayRecoveryFuzzTest is PayToPlayTestBase {
    function testFuzzRecoverAfterPartialVoucher(uint96 amount_, uint96 paid_) public {
        uint256 amount = bound(amount_, 1, type(uint96).max);
        uint256 paid = bound(paid_, 0, amount);
        _fund(customer, channel, amount);
        payments.closePosition(customer, channel);
        assertEq(payments.collect(customer, channel, paid, _sign(customer, channel, paid)), paid);
        vm.warp(_position(channel).refundAt);
        assertEq(payments.refund(customer, channel), amount - paid);
        assertEq(payments.channel(channel).escrowTotal, 0);
        assertEq(_position(channel).voucherPaid, paid);
        assertEq(address(payments).balance, 0);
    }
}
