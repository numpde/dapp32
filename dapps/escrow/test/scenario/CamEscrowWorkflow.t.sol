pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";

/// @notice End-to-end deterministic outcome scenarios for every V1 terminal path.
contract CamEscrowWorkflowTest is Test {
    uint256 private constant AMOUNT = 7 ether;
    uint64 private constant PHASE_DURATION = 3 days;

    address private contractor = address(0xC0FFEE);
    address private arbitrator = address(0xA11CE);
    address private finalizer = address(0xF1A1);

    CamEscrow private escrow;

    function setUp() public {
        escrow = new CamEscrow();
        vm.deal(address(this), 1_000 ether);
        vm.deal(contractor, 100 ether);
        vm.deal(arbitrator, 100 ether);
        vm.deal(finalizer, 100 ether);
    }

    function testClientCancelsBeforeAcceptance() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);

        escrow.cancelAgreement(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.CancelledByClient,
            address(this)
        );
        _withdrawClient(payable(address(0x1001)));
    }

    function testContractorCompletesAndClientApproves() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _accept(agreementId);
        _submit(agreementId);

        escrow.approveAgreement(agreementId);

        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.submission.uri, "ipfs://submission");
        assertEq(view_.submission.sha256Digest, sha256(bytes("submission")));
        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.ReleasedByClientApproval,
            contractor
        );
        _withdrawContractor(payable(address(0x1002)));
    }

    function testAcceptanceTimeoutRefundsClient() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeAcceptanceTimeout(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout,
            address(this)
        );
        _withdrawClient(payable(address(0x1003)));
    }

    function testWorkTimeoutRefundsClient() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _accept(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeWorkTimeout(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.RefundedAfterWorkTimeout,
            address(this)
        );
        _withdrawClient(payable(address(0x1004)));
    }

    function testReviewTimeoutReleasesContractor() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _accept(agreementId);
        _submit(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeReviewTimeout(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.ReleasedAfterReviewTimeout,
            contractor
        );
        _withdrawContractor(payable(address(0x1005)));
    }

    function testArbitratorRefundsClient() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _acceptSubmitAndDispute(agreementId);

        vm.prank(arbitrator);
        escrow.resolveForClient(agreementId);

        _assertDisputeStored(agreementId);
        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.RefundedByArbitrator,
            address(this)
        );
        _withdrawClient(payable(address(0x1006)));
    }

    function testArbitratorReleasesContractor() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor);
        _acceptSubmitAndDispute(agreementId);

        vm.prank(arbitrator);
        escrow.resolveForContractor(agreementId);

        _assertDisputeStored(agreementId);
        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.ReleasedByArbitrator,
            contractor
        );
        _withdrawContractor(payable(address(0x1007)));
    }

    function testArbitrationTimeoutConfiguredForClientRefundsClientInFull() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
        _acceptSubmitAndDispute(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeArbitrationTimeout(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout,
            address(this)
        );
        assertEq(escrow.withdrawable(contractor), 0);
        _withdrawClient(payable(address(0x1008)));
    }

    function testArbitrationTimeoutConfiguredForContractorReleasesContractorInFull() external {
        bytes32 agreementId = _create(ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor);
        _acceptSubmitAndDispute(agreementId);
        _warpToDeadline(agreementId);

        vm.prank(finalizer);
        escrow.finalizeArbitrationTimeout(agreementId);

        _assertTerminal(
            agreementId,
            ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout,
            contractor
        );
        assertEq(escrow.withdrawable(address(this)), 0);
        _withdrawContractor(payable(address(0x1009)));
    }

    function _create(ICamEscrowView.ArbitrationTimeoutBeneficiary timeoutBeneficiary)
        private
        returns (bytes32)
    {
        CamEscrow.CreateAgreementParams memory params;
        params.agreementRef = "scenario";
        params.contractor = contractor;
        params.arbitrator = arbitrator;
        params.arbitrationTimeoutBeneficiary = timeoutBeneficiary;
        params.amount = AMOUNT;
        params.acceptanceDuration = PHASE_DURATION;
        params.workDuration = PHASE_DURATION;
        params.reviewDuration = PHASE_DURATION;
        params.arbitrationDuration = PHASE_DURATION;
        params.terms = _document("ipfs://terms", "terms");
        return escrow.createAgreement{value: AMOUNT}(params);
    }

    function _accept(bytes32 agreementId) private {
        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);
    }

    function _submit(bytes32 agreementId) private {
        vm.prank(contractor);
        escrow.submitAgreement(agreementId, _document("ipfs://submission", "submission"));
    }

    function _acceptSubmitAndDispute(bytes32 agreementId) private {
        _accept(agreementId);
        _submit(agreementId);
        escrow.disputeAgreement(agreementId, _document("ipfs://dispute", "dispute"));
    }

    function _warpToDeadline(bytes32 agreementId) private {
        vm.warp(escrow.agreementById(agreementId).deadline);
    }

    function _assertDisputeStored(bytes32 agreementId) private view {
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.dispute.uri, "ipfs://dispute");
        assertEq(view_.dispute.sha256Digest, sha256(bytes("dispute")));
    }

    function _assertTerminal(
        bytes32 agreementId,
        ICamEscrowView.AgreementState expectedState,
        address beneficiary
    ) private view {
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

    function _document(string memory uri, string memory seed)
        private
        pure
        returns (ICamEscrowView.DocumentRef memory)
    {
        return ICamEscrowView.DocumentRef({uri: uri, sha256Digest: sha256(bytes(seed))});
    }
}
