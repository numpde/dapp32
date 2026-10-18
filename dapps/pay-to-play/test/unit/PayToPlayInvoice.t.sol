pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract PayToPlayInvoiceTest is PayToPlayTestBase {
    bytes32 private constant INVOICE_A = keccak256("invoice A: 0 to 30");
    bytes32 private constant INVOICE_B = keccak256("invoice B: 30 to 70");

    event VoucherCollected(
        address indexed customer,
        uint256 indexed channelId,
        address indexed payee,
        uint256 amount,
        uint256 voucherPaid,
        bytes32 invoiceHash
    );

    function testDigestUsesVersionTwoAndAllFourFields() public view {
        bytes32 typeHash =
            keccak256("Voucher(address customer,uint256 channelId,uint256 cumulativeTotal,bytes32 invoiceHash)");
        assertEq(payments.VOUCHER_TYPEHASH(), typeHash);
        bytes32 structHash = keccak256(abi.encode(typeHash, customer, channel, uint256(70), INVOICE_B));
        assertEq(payments.voucherDigest(customer, channel, 70, INVOICE_B), _digest("2", structHash));
        assertTrue(
            payments.voucherDigest(customer, channel, 70, INVOICE_A)
                != payments.voucherDigest(customer, channel, 70, INVOICE_B)
        );
    }

    function testHashSubstitutionFailsForFundedEmptyAndAlreadyPaidPositions() public {
        bytes memory signature = _sign(customer, channel, 70, INVOICE_B);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 70, INVOICE_A, signature);
        _fund(customer, channel, 100);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 70, INVOICE_A, signature);
        assertEq(_position(channel).balance, 100);
        assertEq(_position(channel).voucherPaid, 0);
        assertEq(payments.collect(customer, channel, 70, INVOICE_B, signature), 70);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 70, INVOICE_A, signature);
        assertEq(_position(channel).balance, 30);
        assertEq(_position(channel).voucherPaid, 70);
    }

    function testDifferentHashesAtSameTotalDoNotCreateIndependentEntitlements() public {
        _fund(customer, channel, 100);
        bytes memory first = _sign(customer, channel, 70, INVOICE_A);
        bytes memory second = _sign(customer, channel, 70, INVOICE_B);
        assertEq(payments.collect(customer, channel, 70, INVOICE_A, first), 70);
        vm.recordLogs();
        assertEq(payments.collect(customer, channel, 70, INVOICE_B, second), 0);
        assertEq(vm.getRecordedLogs().length, 0, "a zero collection is not an invoice-payment receipt");
        assertEq(_position(channel).balance, 30);
        assertEq(_position(channel).voucherPaid, 70);
        assertEq(payee.balance, 70);
    }

    function testLaterInvoiceFirstCanCollectAcrossInvoicesPartiallyAndRetry() public {
        bytes memory first = _sign(customer, channel, 30, INVOICE_A);
        bytes memory second = _sign(customer, channel, 70, INVOICE_B);
        _fund(customer, channel, 50);
        vm.expectEmit(true, true, true, true, address(payments));
        emit VoucherCollected(customer, channel, payee, 50, 50, INVOICE_B);
        vm.prank(relayer);
        assertEq(payments.collect(customer, channel, 70, INVOICE_B, second), 50);
        // The event references B, but these 50 units include A's cumulative interval.
        assertEq(payments.collect(customer, channel, 30, INVOICE_A, first), 0);
        _fund(customer, channel, 20);
        vm.expectEmit(true, true, true, true, address(payments));
        emit VoucherCollected(customer, channel, payee, 20, 70, INVOICE_B);
        assertEq(payments.collect(customer, channel, 70, INVOICE_B, second), 20);
        assertEq(payments.collect(customer, channel, 70, INVOICE_B, second), 0);
        assertEq(_position(channel).voucherPaid, 70);
        assertEq(payee.balance, 70);
    }

    function testInvoiceReferenceHasNoUniquenessOrConsumptionState() public {
        _fund(customer, channel, 100);
        bytes memory first = _sign(customer, channel, 30, INVOICE_A);
        bytes memory second = _sign(customer, channel, 70, INVOICE_A);
        assertEq(payments.collect(customer, channel, 30, INVOICE_A, first), 30);
        assertEq(payments.collect(customer, channel, 70, INVOICE_A, second), 40);
        assertEq(_position(channel).voucherPaid, 70);
    }

    function testInvoiceBytesAreOpaqueIncludingZeroHash() public {
        _fund(customer, channel, 10);
        bytes memory signature = _sign(customer, channel, 10, bytes32(0));
        assertEq(payments.collect(customer, channel, 10, bytes32(0), signature), 10);
    }

    function testAcceptanceExpiryInInvoiceDoesNotExpireIssuedVoucher() public {
        uint256 acceptanceExpiry = block.timestamp + 10;
        bytes32 invoiceHash = keccak256(abi.encode("invoice acceptance expiry", acceptanceExpiry));
        bytes memory signature = _sign(customer, channel, 30, invoiceHash);
        _fund(customer, channel, 100);
        vm.warp(acceptanceExpiry + 1);
        assertEq(payments.collect(customer, channel, 30, invoiceHash, signature), 30);
    }

    function testCollateralRefundAndReusePreserveInvoiceVoucherExposure() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 100, INVOICE_A);
        // Partial payment leaves a durable unpaid authorization, not a per-invoice paid flag.
        payments.collect(customer, channel, 30, INVOICE_B, _sign(customer, channel, 30, INVOICE_B));
        payments.closePosition(customer, channel);
        uint256 deadline = _position(channel).refundAt;
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.VoucherCollectionEnded.selector, deadline));
        payments.collect(customer, channel, 100, INVOICE_A, signature);
        assertEq(payments.refund(customer, channel), 70);
        assertEq(_position(channel).voucherPaid, 30);
        assertEq(_position(channel).voucherKey, vm.addr(VOUCHER_KEY));
        _fund(customer, channel, 50);
        assertEq(payments.collect(customer, channel, 100, INVOICE_A, signature), 50);
        assertEq(_position(channel).voucherPaid, 80);
    }

    function testChannelRetirementEndsCollectionRegardlessOfInvoiceReference() public {
        _fund(customer, channel, 100);
        bytes memory first = _sign(customer, channel, 30, INVOICE_A);
        bytes memory second = _sign(customer, channel, 70, INVOICE_B);
        payments.closeChannel(channel);
        uint256 deadline = _position(channel).refundAt;
        vm.warp(deadline - 1);
        assertEq(payments.collect(customer, channel, 30, INVOICE_A, first), 30);
        vm.warp(deadline);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.VoucherCollectionEnded.selector, deadline));
        payments.collect(customer, channel, 70, INVOICE_B, second);
        assertEq(payments.refund(customer, channel), 70);
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.VoucherCollectionEnded.selector, deadline));
        payments.collect(customer, channel, 70, INVOICE_B, second);
        assertEq(_position(channel).voucherPaid, 30);
    }

    function testInvoiceReferenceDoesNotChangeTrustedPayeeAdministration() public {
        _fund(customer, channel, 100);
        bytes memory signature = _sign(customer, channel, 30, INVOICE_A);
        payments.setPayee(channel, relayer);
        vm.expectEmit(true, true, true, true, address(payments));
        emit VoucherCollected(customer, channel, relayer, 30, 30, INVOICE_A);
        assertEq(payments.collect(customer, channel, 30, INVOICE_A, signature), 30);
        assertEq(relayer.balance, 30);
        assertEq(payee.balance, 0);
    }

    function testLegacySchemaAndVersionAreRejectedWithoutFallback() public {
        _fund(customer, channel, 100);
        bytes32 oldStructHash = keccak256(
            abi.encode(
                keccak256("Voucher(address customer,uint256 channelId,uint256 cumulativeTotal)"),
                customer,
                channel,
                uint256(70)
            )
        );
        bytes32 newStructHash =
            keccak256(abi.encode(payments.VOUCHER_TYPEHASH(), customer, channel, uint256(70), INVOICE_B));
        _rejectDigest(_digest("1", oldStructHash));
        _rejectDigest(_digest("2", oldStructHash));
        _rejectDigest(_digest("1", newStructHash));
        assertEq(_position(channel).balance, 100);
        assertEq(_position(channel).voucherPaid, 0);
    }

    function testOldCollectionAndDigestSelectorsAreUnavailable() public {
        bytes memory signature = _sign(customer, channel, 70, INVOICE_B);
        (bool collected,) = address(payments)
            .call(abi.encodeWithSignature("collect(address,uint256,uint256,bytes)", customer, channel, 70, signature));
        (bool read,) = address(payments)
            .staticcall(abi.encodeWithSignature("voucherDigest(address,uint256,uint256)", customer, channel, 70));
        assertFalse(collected);
        assertFalse(read);
    }

    function _digest(string memory version, bytes32 structHash) private view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("PayToPlay"),
                keccak256(bytes(version)),
                block.chainid,
                address(payments)
            )
        );
        return keccak256(abi.encodePacked(hex"1901", domain, structHash));
    }

    function _rejectDigest(bytes32 digest) private {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VOUCHER_KEY, digest);
        vm.expectRevert(PayToPlay.InvalidVoucherSignature.selector);
        payments.collect(customer, channel, 70, INVOICE_B, abi.encodePacked(r, s, v));
    }
}
