pragma solidity 0.8.35;

import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract PayToPlayFuzzTest is PayToPlayTestBase {
    function testFuzzPartialVoucherKeepsLifetimePaid(uint96 initial, uint96 later, uint96 total) public {
        _fund(customer, channel, initial);
        bytes memory signature = _sign(customer, channel, total);
        uint256 first = payments.collect(customer, channel, total, signature);
        assertEq(first, initial < total ? initial : total);
        _fund(customer, channel, later);
        uint256 second = payments.collect(customer, channel, total, signature);
        uint256 expected = uint256(initial) + later;
        if (expected > total) expected = total;
        assertEq(first + second, expected);
        assertEq(_position(channel).voucherPaid, expected);
        assertEq(_position(channel).balance + expected, uint256(initial) + later);
        assertEq(payments.collect(customer, channel, total, signature), 0);
    }

    function testFuzzWithdrawalConsumesCapAfterCollection(uint96 rawBalance, uint96 rawRequest, uint96 total) public {
        uint256 balance = bound(rawBalance, 1, type(uint96).max);
        uint256 request = bound(rawRequest, 1, balance);
        _fund(customer, channel, balance);
        vm.prank(customer);
        payments.requestWithdrawal(channel, request);
        uint256 paid = payments.collect(customer, channel, total, _sign(customer, channel, total));
        uint256 remaining = balance - paid;
        assertEq(_position(channel).effectiveBalance, remaining > request ? remaining - request : 0);
        vm.warp(_position(channel).readyAt);
        uint256 withdrawn = payments.withdraw(customer, channel);
        assertEq(withdrawn, remaining < request ? remaining : request);
        assertEq(_position(channel).requestedAmount, 0);
        assertEq(_position(channel).voucherPaid, paid);
        assertEq(address(payments).balance + withdrawn + paid, balance);
    }
}
