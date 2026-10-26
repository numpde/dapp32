pragma solidity 0.8.35;

import {ICamApp} from "../../cam/src/ICamApp.sol";
import {PayToPlay} from "./PayToPlay.sol";

/// @notice Read-only signing context for one payment contract, checked against the selected CAM host.
contract PayToPlayUI {
    PayToPlay public immutable payments;

    error PaymentBindingMismatch(address expected, address actual);

    constructor(address paymentContract) {
        payments = PayToPlay(paymentContract);
    }

    struct VoucherSigningDetails {
        string domainName;
        string domainVersion;
        uint256 chainId;
        address verifyingContract;
        address voucherKey;
        bytes32 digest;
    }

    /// @notice Reads the payment domain, registered key and digest for the supplied voucher message.
    function viewVoucherSigningDetails(
        address camHost,
        address customer,
        uint256 channelId,
        uint256 cumulativeTotal,
        bytes32 invoiceHash
    ) external view returns (VoucherSigningDetails memory details) {
        address boundPayment = ICamApp(camHost).contractAddress("PayToPlay");
        if (boundPayment != address(payments)) revert PaymentBindingMismatch(address(payments), boundPayment);
        (, details.domainName, details.domainVersion, details.chainId, details.verifyingContract,,) =
            payments.eip712Domain();
        details.voucherKey = payments.viewPosition(customer, channelId, address(0)).voucherKey;
        details.digest = payments.voucherDigest(customer, channelId, cumulativeTotal, invoiceHash);
    }
}
