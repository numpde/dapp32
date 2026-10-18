pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract PayToPlayFuzzTest is PayToPlayTestBase {
    function testFuzzPartialVoucherKeepsLifetimePaid(uint96 initial, uint96 later, uint96 total, bytes32 invoiceHash)
        public
    {
        _fund(customer, channel, initial);
        bytes memory signature = _sign(customer, channel, total, invoiceHash);
        uint256 first = payments.collect(customer, channel, total, invoiceHash, signature);
        assertEq(first, initial < total ? initial : total);
        _fund(customer, channel, later);
        uint256 second = payments.collect(customer, channel, total, invoiceHash, signature);
        uint256 expected = uint256(initial) + later;
        if (expected > total) expected = total;
        assertEq(first + second, expected);
        assertEq(_position(channel).voucherPaid, expected);
        assertEq(_position(channel).balance + expected, uint256(initial) + later);
        assertEq(payments.collect(customer, channel, total, invoiceHash, signature), 0);
    }

    function testFuzzWithdrawalConsumesCapAfterCollection(uint96 rawBalance, uint96 rawRequest, uint96 total) public {
        uint256 balance = bound(rawBalance, 1, type(uint96).max);
        uint256 request = bound(rawRequest, 1, balance);
        _fund(customer, channel, balance);
        vm.prank(customer);
        payments.requestWithdrawal(channel, request);
        uint256 paid = payments.collect(customer, channel, total, INVOICE_HASH, _sign(customer, channel, total));
        uint256 remaining = balance - paid;
        assertEq(_position(channel).effectiveBalance, remaining > request ? remaining - request : 0);
        vm.warp(_position(channel).readyAt);
        uint256 withdrawn = payments.withdraw(customer, channel);
        assertEq(withdrawn, remaining < request ? remaining : request);
        assertEq(_position(channel).requestedAmount, 0);
        assertEq(_position(channel).voucherPaid, paid);
        assertEq(address(payments).balance + withdrawn + paid, balance);
    }

    function testFuzzDifferentInvoiceHashesShareOnePaidCounter(uint96 balance, uint96 total, bytes32 invoiceHash)
        public
    {
        bytes32 otherHash = invoiceHash ^ bytes32(uint256(1));
        bytes memory first = _sign(customer, channel, total, invoiceHash);
        bytes memory second = _sign(customer, channel, total, otherHash);
        _fund(customer, channel, balance);
        uint256 paid = payments.collect(customer, channel, total, invoiceHash, first);
        assertEq(payments.collect(customer, channel, total, otherHash, second), 0);
        assertEq(_position(channel).voucherPaid, paid);
        assertEq(_position(channel).balance + paid, balance);
    }

    function testFuzzInvoiceHashCannotBeSubstituted(uint96 balance, uint96 total, bytes32 invoiceHash) public {
        bytes memory signature = _sign(customer, channel, total, invoiceHash);
        _fund(customer, channel, balance);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, total, invoiceHash ^ bytes32(uint256(1)), signature);
        assertEq(_position(channel).balance, balance);
        assertEq(_position(channel).voucherPaid, 0);
        assertEq(payments.channel(channel).escrowTotal, balance);
    }
}
