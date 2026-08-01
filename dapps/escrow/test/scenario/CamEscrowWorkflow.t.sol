pragma solidity 0.8.35;

import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowTestBase} from "../support/CamEscrowTestBase.sol";

/// @notice End-to-end deterministic outcome scenarios for every V1 terminal path.
contract CamEscrowWorkflowTest is CamEscrowTestBase {
    /// @notice A client may cancel an unaccepted agreement and withdraw the complete refund.
    function testClientCancelsBeforeAcceptance() external {
        bytes32 agreementId = _create("scenario");

        escrow.cancelAgreement(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.CancelledByClient, address(this));
        _withdrawClient(payable(address(0x1001)));
    }

    /// @notice Successful submission plus client approval releases the complete amount to the contractor.
    function testContractorCompletesAndClientApproves() external {
        bytes32 agreementId = _create("scenario");
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "submission");

        escrow.approveAgreement(agreementId);

        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.submission.uri, "ipfs://submission");
        assertEq(view_.submission.sha256Digest, sha256(bytes("submission")));
        _assertTerminal(agreementId, ICamEscrowView.AgreementState.ReleasedByClientApproval, contractor);
        _withdrawContractor(payable(address(0x1002)));
    }

    /// @notice Anyone may finalize an expired acceptance phase, refunding the client in full.
    function testAcceptanceTimeoutRefundsClient() external {
        bytes32 agreementId = _create("scenario");
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeAcceptanceTimeout(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout, address(this));
        _withdrawClient(payable(address(0x1003)));
    }

    /// @notice Anyone may finalize an expired work phase, refunding the client in full.
    function testWorkTimeoutRefundsClient() external {
        bytes32 agreementId = _create("scenario");
        _accept(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeWorkTimeout(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.RefundedAfterWorkTimeout, address(this));
        _withdrawClient(payable(address(0x1004)));
    }

    /// @notice Anyone may finalize an undisputed review timeout, releasing the contractor in full.
    function testReviewTimeoutReleasesContractor() external {
        bytes32 agreementId = _create("scenario");
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "submission");
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeReviewTimeout(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.ReleasedAfterReviewTimeout, contractor);
        _withdrawContractor(payable(address(0x1005)));
    }

    /// @notice The arbitrator may resolve a live dispute completely for the client.
    function testArbitratorRefundsClient() external {
        bytes32 agreementId = _create("scenario");
        _acceptSubmitAndDispute(agreementId);

        vm.prank(arbitrator);
        escrow.resolveForClient(agreementId);

        _assertDisputeStored(agreementId);
        _assertTerminal(agreementId, ICamEscrowView.AgreementState.RefundedByArbitrator, address(this));
        _withdrawClient(payable(address(0x1006)));
    }

    /// @notice The arbitrator may resolve a live dispute completely for the contractor.
    function testArbitratorReleasesContractor() external {
        bytes32 agreementId = _create("scenario", ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor);
        _acceptSubmitAndDispute(agreementId);

        vm.prank(arbitrator);
        escrow.resolveForContractor(agreementId);

        _assertDisputeStored(agreementId);
        _assertTerminal(agreementId, ICamEscrowView.AgreementState.ReleasedByArbitrator, contractor);
        _withdrawContractor(payable(address(0x1007)));
    }

    /// @notice Client-configured arbitration timeout refunds only the client and leaves no residual contractor credit.
    function testArbitrationTimeoutConfiguredForClientRefundsClientInFull() external {
        bytes32 agreementId = _create("scenario", ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _acceptSubmitAndDispute(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeArbitrationTimeout(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout, address(this));
        assertEq(escrow.withdrawable(contractor), 0);
        _withdrawClient(payable(address(0x1008)));
    }

    /// @notice Contractor-configured arbitration timeout releases only the contractor and leaves no residual client credit.
    function testArbitrationTimeoutConfiguredForContractorReleasesContractorInFull() external {
        bytes32 agreementId = _create("scenario", ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor);
        _acceptSubmitAndDispute(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeArbitrationTimeout(agreementId);

        _assertTerminal(agreementId, ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout, contractor);
        assertEq(escrow.withdrawable(address(this)), 0);
        _withdrawContractor(payable(address(0x1009)));
    }

    function _assertDisputeStored(bytes32 agreementId) private view {
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.dispute.uri, "ipfs://dispute");
        assertEq(view_.dispute.sha256Digest, sha256(bytes("dispute")));
    }

    function _assertTerminal(bytes32 agreementId, ICamEscrowView.AgreementState expectedState, address beneficiary)
        private
        view
    {
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(uint256(view_.state), uint256(expectedState));
        assertEq(view_.deadline, 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalWithdrawable(), AMOUNT);
        assertEq(escrow.totalLiabilities(), AMOUNT);
        assertEq(escrow.withdrawable(beneficiary), AMOUNT);
        assertEq(address(escrow).balance, AMOUNT);
    }

    function _withdrawClient(address payable recipient) private {
        escrow.withdrawTo(recipient);
        _assertWithdrawn(recipient);
    }

    function _withdrawContractor(address payable recipient) private {
        vm.prank(contractor);
        escrow.withdrawTo(recipient);
        _assertWithdrawn(recipient);
    }

    function _assertWithdrawn(address recipient) private view {
        assertEq(recipient.balance, AMOUNT);
        assertEq(address(escrow).balance, 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.totalLiabilities(), 0);
    }
}
