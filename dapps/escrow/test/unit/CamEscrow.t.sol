pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowTestBase} from "../support/CamEscrowTestBase.sol";

contract RejectNativeRecipient {
    receive() external payable {
        revert("reject native");
    }
}

contract ReentrantContractor {
    CamEscrow private immutable _escrow;
    bool private _reenter;

    constructor(CamEscrow escrow_) {
        _escrow = escrow_;
    }

    function accept(bytes32 agreementId) external {
        _escrow.acceptAgreement(agreementId);
    }

    function submit(bytes32 agreementId, ICamEscrowView.DocumentRef calldata document) external {
        _escrow.submitAgreement(agreementId, document);
    }

    function withdraw(bool reenter) external {
        _reenter = reenter;
        _escrow.withdrawTo(payable(address(this)));
        _reenter = false;
    }

    receive() external payable {
        if (_reenter) {
            _escrow.withdrawTo(payable(address(this)));
        }
    }
}

/// @notice Deterministic contract-boundary tests for the V1 escrow.
contract CamEscrowTest is CamEscrowTestBase {
    event AgreementCreated(
        bytes32 indexed agreementId,
        address indexed client,
        address indexed contractor,
        address arbitrator,
        uint256 amount,
        uint256 deadline
    );

    event AgreementStateChanged(
        bytes32 indexed agreementId,
        address indexed actor,
        ICamEscrowView.AgreementState fromState,
        ICamEscrowView.AgreementState toState,
        uint256 deadline
    );

    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    /// @notice Creation stores all reviewed terms, starts Funded, and exposes one explicit read ABI.
    function testCreateAgreementStoresTermsAndLiabilities() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("agreement-1");
        bytes32 expectedId = keccak256(abi.encode(address(this), params.agreementRef));
        uint256 expectedDeadline = block.timestamp + ACCEPTANCE_DURATION;

        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgreementCreated(expectedId, address(this), contractor, arbitrator, AMOUNT, expectedDeadline);

        bytes32 agreementId = escrow.createAgreement{value: AMOUNT}(params);
        assertEq(agreementId, expectedId);
        assertEq(escrow.agreementIdOf(address(this), params.agreementRef), expectedId);

        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.agreementId, expectedId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.Funded));
        assertEq(view_.client, address(this));
        assertEq(view_.contractor, contractor);
        assertEq(view_.arbitrator, arbitrator);
        assertEq(
            uint256(view_.arbitrationTimeoutBeneficiary), uint256(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client)
        );
        assertEq(view_.amount, AMOUNT);
        assertEq(view_.acceptanceDuration, ACCEPTANCE_DURATION);
        assertEq(view_.workDuration, WORK_DURATION);
        assertEq(view_.reviewDuration, REVIEW_DURATION);
        assertEq(view_.arbitrationDuration, ARBITRATION_DURATION);
        assertEq(view_.deadline, expectedDeadline);
        assertEq(view_.agreementRef, params.agreementRef);
        assertEq(view_.terms.uri, params.terms.uri);
        assertEq(view_.terms.sha256Digest, params.terms.sha256Digest);
        assertEq(view_.submission.uri, "");
        assertEq(view_.submission.sha256Digest, bytes32(0));
        assertEq(view_.dispute.uri, "");
        assertEq(view_.dispute.sha256Digest, bytes32(0));

        ICamEscrowView.AgreementView memory byReference =
            escrow.agreementByReference(address(this), params.agreementRef);
        assertEq(byReference.agreementId, agreementId);
        assertEq(uint256(byReference.state), uint256(ICamEscrowView.AgreementState.Funded));

        assertEq(address(escrow).balance, AMOUNT);
        assertEq(escrow.totalEscrowed(), AMOUNT);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.totalLiabilities(), AMOUNT);
        assertEq(escrow.withdrawable(address(this)), 0);

        assertTrue(escrow.supportsInterface(type(ICamEscrowView).interfaceId));
        assertTrue(escrow.supportsInterface(type(IERC165).interfaceId));
        assertFalse(escrow.supportsInterface(0xffffffff));
        assertLt(address(escrow).code.length, 24_576);
    }

    /// @notice Missing reads are ordinary absent observations and writes report stable absence.
    function testMissingAgreementReadAndWriteBoundaries() external {
        bytes32 missingId = keccak256("missing");
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(missingId);

        assertEq(view_.agreementId, missingId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.None));
        assertEq(view_.client, address(0));
        assertEq(escrow.availableActions(missingId, contractor).length, 0);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.AgreementNotFound.selector, missingId));
        vm.prank(contractor);
        escrow.acceptAgreement(missingId);
    }

    /// @notice Creation rejects malformed identity, unsafe policy values, and malformed terms.
    function testCreateAgreementValidationSurface() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("valid");

        params.agreementRef = "";
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidReferenceLength.selector, 0));
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams(_stringOfLength(escrow.MAX_AGREEMENT_REF_BYTES() + 1));
        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.InvalidReferenceLength.selector, escrow.MAX_AGREEMENT_REF_BYTES() + 1)
        );
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("none-beneficiary");
        params.arbitrationTimeoutBeneficiary = ICamEscrowView.ArbitrationTimeoutBeneficiary.None;
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidArbitrationTimeoutBeneficiary.selector,
                ICamEscrowView.ArbitrationTimeoutBeneficiary.None
            )
        );
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("zero-amount");
        params.amount = 0;
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidAmount.selector, 0));
        escrow.createAgreement(params);

        params = _defaultParams("underpaid");
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.NativeAmountMismatch.selector, AMOUNT, AMOUNT - 1));
        escrow.createAgreement{value: AMOUNT - 1}(params);

        params = _defaultParams("empty-uri");
        params.terms.uri = "";
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidDocumentURI.selector, 0));
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("zero-digest");
        params.terms.sha256Digest = bytes32(0);
        vm.expectRevert(CamEscrow.InvalidDocumentDigest.selector);
        escrow.createAgreement{value: AMOUNT}(params);
    }

    /// @notice A client/reference key is permanent and scoped to its client.
    function testAgreementReferenceIsClientScopedAndNeverReusable() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("shared-ref");
        bytes32 firstId = escrow.createAgreement{value: AMOUNT}(params);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.AgreementAlreadyExists.selector, firstId));
        escrow.createAgreement{value: AMOUNT}(params);

        address otherClient = address(0xD00D);
        vm.deal(otherClient, AMOUNT);
        vm.prank(otherClient);
        bytes32 secondId = escrow.createAgreement{value: AMOUNT}(params);

        assertNotEq(firstId, secondId);
        assertEq(secondId, keccak256(abi.encode(otherClient, params.agreementRef)));
        assertEq(escrow.totalEscrowed(), 2 * AMOUNT);
    }

    /// @notice Contractor acceptance needs no arbitrator transaction, signature, or stored acknowledgement.
    function testAcceptanceNeedsNoArbitratorActionAndSharesTheAvailableActionPredicate() external {
        bytes32 agreementId = _create("no-ack");

        _assertActions(agreementId, contractor, _actions1(ICamEscrowView.AgreementAction.AcceptAgreement));
        _assertActions(agreementId, address(this), _actions1(ICamEscrowView.AgreementAction.CancelAgreement));
        _assertNoActions(agreementId, arbitrator);
        _assertNoActions(agreementId, address(0));

        uint256 nextDeadline = block.timestamp + WORK_DURATION;
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgreementStateChanged(
            agreementId,
            contractor,
            ICamEscrowView.AgreementState.Funded,
            ICamEscrowView.AgreementState.Accepted,
            nextDeadline
        );

        _accept(agreementId);
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.Accepted));
        assertEq(view_.deadline, nextDeadline);

        bytes4 acknowledgementSelector = bytes4(keccak256("acknowledgeAgreement(bytes32)"));
        (bool ok, bytes memory result) =
            address(escrow).call(abi.encodeWithSelector(acknowledgementSelector, agreementId));
        assertFalse(ok);
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrow.UnknownFunction.selector, acknowledgementSelector))
        );
    }

    /// @notice Ordinary actions stop exactly at a deadline and timeout actions begin at that timestamp.
    function testDeadlineBoundaryIsDisjoint() external {
        bytes32 agreementId = _create("deadline-boundary");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertActions(agreementId, contractor, _actions1(ICamEscrowView.AgreementAction.AcceptAgreement));

        vm.warp(deadline);
        _assertActions(agreementId, contractor, _actions1(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout));
        _assertActions(agreementId, unrelated, _actions1(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout));

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                agreementId,
                ICamEscrowView.AgreementAction.AcceptAgreement,
                contractor,
                ICamEscrowView.AgreementState.Funded,
                deadline,
                deadline
            )
        );
        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);
    }

    /// @notice Funded exposes only role actions before expiry and public finalization after expiry.
    function testFundedAvailableActions() external {
        bytes32 agreementId = _create("actions-funded");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertActions(agreementId, address(this), _actions1(ICamEscrowView.AgreementAction.CancelAgreement));
        _assertActions(agreementId, contractor, _actions1(ICamEscrowView.AgreementAction.AcceptAgreement));
        _assertNoActions(agreementId, arbitrator);
        _assertNoActions(agreementId, unrelated);

        _assertPublicTimeoutAction(agreementId, deadline, ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout);
    }

    /// @notice Accepted exposes submission before expiry and public work-timeout finalization afterward.
    function testAcceptedAvailableActions() external {
        bytes32 agreementId = _create("actions-accepted");
        _accept(agreementId);
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertNoActions(agreementId, address(this));
        _assertActions(agreementId, contractor, _actions1(ICamEscrowView.AgreementAction.SubmitAgreement));
        _assertNoActions(agreementId, arbitrator);
        _assertNoActions(agreementId, unrelated);

        _assertPublicTimeoutAction(agreementId, deadline, ICamEscrowView.AgreementAction.FinalizeWorkTimeout);
    }

    /// @notice Submitted exposes client approval/dispute before expiry and public review finalization afterward.
    function testSubmittedAvailableActions() external {
        bytes32 agreementId = _create("actions-submitted");
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "submission");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertActions(
            agreementId,
            address(this),
            _actions2(ICamEscrowView.AgreementAction.ApproveAgreement, ICamEscrowView.AgreementAction.DisputeAgreement)
        );
        _assertNoActions(agreementId, contractor);
        _assertNoActions(agreementId, arbitrator);
        _assertNoActions(agreementId, unrelated);

        _assertPublicTimeoutAction(agreementId, deadline, ICamEscrowView.AgreementAction.FinalizeReviewTimeout);
    }

    /// @notice Disputed exposes only arbitrator outcomes before expiry and public fallback afterward.
    function testDisputedAvailableActions() external {
        bytes32 agreementId = _create("actions-disputed");
        _acceptSubmitAndDispute(agreementId);
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertNoActions(agreementId, address(this));
        _assertNoActions(agreementId, contractor);
        _assertActions(
            agreementId,
            arbitrator,
            _actions2(
                ICamEscrowView.AgreementAction.ResolveForClient, ICamEscrowView.AgreementAction.ResolveForContractor
            )
        );
        _assertNoActions(agreementId, unrelated);

        _assertPublicTimeoutAction(agreementId, deadline, ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout);
    }

    /// @notice State, actor, and time legality is checked before evidence payload validity.
    function testEvidenceValidationFollowsActionAvailability() external {
        bytes32 agreementId = _create("payload-order");
        ICamEscrowView.DocumentRef memory invalidDocument =
            ICamEscrowView.DocumentRef({uri: "", sha256Digest: bytes32(0)});
        uint256 fundedDeadline = escrow.agreementById(agreementId).deadline;

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                agreementId,
                ICamEscrowView.AgreementAction.SubmitAgreement,
                unrelated,
                ICamEscrowView.AgreementState.Funded,
                fundedDeadline,
                block.timestamp
            )
        );
        vm.prank(unrelated);
        escrow.submitAgreement(agreementId, invalidDocument);

        _accept(agreementId);
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidDocumentURI.selector, 0));
        vm.prank(contractor);
        escrow.submitAgreement(agreementId, invalidDocument);
    }

    /// @notice An exact timeout function cannot silently settle a different expired phase.
    function testStaleTimeoutFunctionCannotFinalizeAnotherPhase() external {
        bytes32 agreementId = _create("exact-timeout");
        _accept(agreementId);

        ICamEscrowView.AgreementView memory accepted = escrow.agreementById(agreementId);
        vm.warp(accepted.deadline);

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                agreementId,
                ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout,
                unrelated,
                ICamEscrowView.AgreementState.Accepted,
                accepted.deadline,
                accepted.deadline
            )
        );
        vm.prank(unrelated);
        escrow.finalizeAcceptanceTimeout(agreementId);

        vm.prank(unrelated);
        escrow.finalizeWorkTimeout(agreementId);
        _assertState(agreementId, ICamEscrowView.AgreementState.RefundedAfterWorkTimeout);
    }

    /// @notice Credits aggregate, may be redirected, and failed transfers restore all accounting.
    function testWithdrawalAggregationAlternateRecipientAndFailureAtomicity() external {
        bytes32 firstId = _create("credit-1");
        bytes32 secondId = _create("credit-2");

        escrow.cancelAgreement(firstId);
        escrow.cancelAgreement(secondId);

        assertEq(escrow.withdrawable(address(this)), 2 * AMOUNT);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalWithdrawable(), 2 * AMOUNT);
        assertEq(escrow.totalLiabilities(), 2 * AMOUNT);

        RejectNativeRecipient rejecting = new RejectNativeRecipient();
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.NativeTransferFailed.selector, address(rejecting), 2 * AMOUNT));
        escrow.withdrawTo(payable(address(rejecting)));

        assertEq(escrow.withdrawable(address(this)), 2 * AMOUNT);
        assertEq(escrow.totalWithdrawable(), 2 * AMOUNT);

        address payable recipient = payable(address(0xFEE));
        vm.expectEmit(true, true, false, true, address(escrow));
        emit Withdrawal(address(this), recipient, 2 * AMOUNT);
        escrow.withdrawTo(recipient);

        assertEq(recipient.balance, 2 * AMOUNT);
        assertEq(escrow.withdrawable(address(this)), 0);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.totalLiabilities(), 0);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.NoWithdrawalCredit.selector, address(this)));
        escrow.withdrawTo(recipient);
    }

    /// @notice Invalid withdrawal destinations and terminal replay leave the complete credit intact.
    function testWithdrawalRecipientValidationAndTerminalIrreversibility() external {
        bytes32 agreementId = _create("terminal-replay");
        escrow.cancelAgreement(agreementId);

        _assertNoActions(agreementId, address(this));
        _assertNoActions(agreementId, unrelated);

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                agreementId,
                ICamEscrowView.AgreementAction.CancelAgreement,
                address(this),
                ICamEscrowView.AgreementState.CancelledByClient,
                0,
                block.timestamp
            )
        );
        escrow.cancelAgreement(agreementId);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidWithdrawalRecipient.selector, address(0)));
        escrow.withdrawTo(payable(address(0)));

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidWithdrawalRecipient.selector, address(escrow)));
        escrow.withdrawTo(payable(address(escrow)));

        assertEq(escrow.withdrawable(address(this)), AMOUNT);
        assertEq(escrow.totalWithdrawable(), AMOUNT);
    }

    /// @notice Reentrant withdrawal cannot duplicate or erase a contractor credit.
    function testWithdrawalReentrancyPreservesCredit() external {
        ReentrantContractor reentrant = new ReentrantContractor(escrow);
        CamEscrow.CreateAgreementParams memory params = _defaultParams("reentrant-withdrawal");
        params.contractor = address(reentrant);
        bytes32 agreementId = escrow.createAgreement{value: AMOUNT}(params);
        ICamEscrowView.DocumentRef memory submission = _document("ipfs://submission", "submission");

        reentrant.accept(agreementId);
        reentrant.submit(agreementId, submission);
        escrow.approveAgreement(agreementId);

        assertEq(escrow.withdrawable(address(reentrant)), AMOUNT);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.NativeTransferFailed.selector, address(reentrant), AMOUNT));
        reentrant.withdraw(true);

        assertEq(escrow.withdrawable(address(reentrant)), AMOUNT);
        assertEq(escrow.totalWithdrawable(), AMOUNT);

        reentrant.withdraw(false);
        assertEq(address(reentrant).balance, AMOUNT);
        assertEq(escrow.withdrawable(address(reentrant)), 0);
        assertEq(escrow.totalWithdrawable(), 0);
    }

    /// @notice Only creation accepts ordinary native value; forced surplus does not become a liability.
    function testDirectTransfersUnknownSelectorsAndForcedSurplus() external {
        (bool ok, bytes memory result) = payable(address(escrow)).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(keccak256(result), keccak256(abi.encodeWithSelector(CamEscrow.DirectNativeTransferDisabled.selector)));

        bytes4 selector = bytes4(0x12345678);
        (ok, result) = address(escrow).call(abi.encodeWithSelector(selector));
        assertFalse(ok);
        assertEq(keccak256(result), keccak256(abi.encodeWithSelector(CamEscrow.UnknownFunction.selector, selector)));

        bytes32 agreementId = _create("forced-surplus");
        assertEq(escrow.totalLiabilities(), AMOUNT);

        vm.deal(address(escrow), address(escrow).balance + 3 ether);
        assertEq(address(escrow).balance, AMOUNT + 3 ether);
        assertEq(escrow.totalEscrowed(), AMOUNT);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.totalLiabilities(), AMOUNT);

        escrow.cancelAgreement(agreementId);
        assertEq(escrow.totalLiabilities(), AMOUNT);
        assertEq(address(escrow).balance, AMOUNT + 3 ether);
    }

    function _assertPublicTimeoutAction(
        bytes32 agreementId,
        uint256 deadline,
        ICamEscrowView.AgreementAction timeoutAction
    ) private {
        vm.warp(deadline);

        address[] memory actors = new address[](4);
        actors[0] = address(this);
        actors[1] = contractor;
        actors[2] = arbitrator;
        actors[3] = unrelated;
        for (uint256 i = 0; i < actors.length; i++) {
            _assertActions(agreementId, actors[i], _actions1(timeoutAction));
        }
        _assertNoActions(agreementId, address(0));

        vm.warp(deadline + 1);
        for (uint256 i = 0; i < actors.length; i++) {
            _assertActions(agreementId, actors[i], _actions1(timeoutAction));
        }
    }
}
