pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";

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
contract CamEscrowTest is Test {
    uint256 private constant AMOUNT = 10 ether;
    uint64 private constant ACCEPTANCE_DURATION = 2 days;
    uint64 private constant WORK_DURATION = 3 days;
    uint64 private constant REVIEW_DURATION = 4 days;
    uint64 private constant ARBITRATION_DURATION = 5 days;

    address private contractor = address(0xC0FFEE);
    address private arbitrator = address(0xA11CE);
    address private unrelated = address(0xB0B);

    CamEscrow private escrow;

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

    function setUp() public {
        escrow = new CamEscrow();
        vm.deal(address(this), 1_000 ether);
        vm.deal(contractor, 100 ether);
        vm.deal(arbitrator, 100 ether);
        vm.deal(unrelated, 100 ether);
    }

    /// @notice Creation stores the reviewed terms, starts Funded, and exposes one explicit read ABI.
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
            uint256(view_.arbitrationTimeoutBeneficiary),
            uint256(ICamEscrowView.ArbitrationTimeoutBeneficiary.Client)
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

    /// @notice Creation rejects malformed identity, party, value, duration, and document terms.
    function testCreateAgreementValidationSurface() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("valid");

        params.agreementRef = "";
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidReferenceLength.selector, 0));
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams(_stringOfLength(escrow.MAX_AGREEMENT_REF_BYTES() + 1));
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidReferenceLength.selector, escrow.MAX_AGREEMENT_REF_BYTES() + 1
            )
        );
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("bad-parties");
        params.contractor = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidPartyConfiguration.selector, address(this), address(0), arbitrator
            )
        );
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("same-parties");
        params.arbitrator = contractor;
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidPartyConfiguration.selector, address(this), contractor, contractor
            )
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

        params = _defaultParams("acceptance-duration");
        params.acceptanceDuration = 0;
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidAcceptanceDuration.selector, 0));
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("work-duration");
        params.workDuration = escrow.MAX_PHASE_DURATION() + 1;
        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.InvalidWorkDuration.selector, escrow.MAX_PHASE_DURATION() + 1)
        );
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("empty-uri");
        params.terms.uri = "";
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidDocumentURI.selector, 0));
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("zero-digest");
        params.terms.sha256Digest = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidDocumentDigest.selector));
        escrow.createAgreement{value: AMOUNT}(params);
    }

    /// @notice A client/reference key is permanent and client scoped.
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

    /// @notice Contractor acceptance requires no arbitrator transaction, signature, or stored acknowledgement.
    function testAcceptanceNeedsNoArbitratorActionAndSharesTheAvailableActionPredicate() external {
        bytes32 agreementId = _create("no-ack");

        _assertActions(
            agreementId,
            contractor,
            _actions1(ICamEscrowView.AgreementAction.AcceptAgreement)
        );
        _assertActions(
            agreementId,
            address(this),
            _actions1(ICamEscrowView.AgreementAction.CancelAgreement)
        );
        assertEq(escrow.availableActions(agreementId, arbitrator).length, 0);
        assertEq(escrow.availableActions(agreementId, address(0)).length, 0);

        uint256 nextDeadline = block.timestamp + WORK_DURATION;
        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgreementStateChanged(
            agreementId,
            contractor,
            ICamEscrowView.AgreementState.Funded,
            ICamEscrowView.AgreementState.Accepted,
            nextDeadline
        );

        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);

        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.Accepted));
        assertEq(view_.deadline, nextDeadline);

        bytes4 acknowledgementSelector = bytes4(keccak256("acknowledgeAgreement(bytes32)"));
        (bool ok, bytes memory result) = address(escrow).call(abi.encodeWithSelector(acknowledgementSelector, agreementId));
        assertFalse(ok);
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrow.UnknownFunction.selector, acknowledgementSelector))
        );
    }

    /// @notice Ordinary actions stop exactly at the deadline and timeout actions start there.
    function testDeadlineBoundaryIsDisjoint() external {
        bytes32 agreementId = _create("deadline-boundary");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertActions(
            agreementId,
            contractor,
            _actions1(ICamEscrowView.AgreementAction.AcceptAgreement)
        );

        vm.warp(deadline);
        _assertActions(
            agreementId,
            contractor,
            _actions1(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout)
        );
        _assertActions(
            agreementId,
            unrelated,
            _actions1(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout)
        );

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

    /// @notice Enabled actions are canonical for every active state and switch exactly at each deadline.
    function testAvailableActionsAcrossEveryActiveStateAndDeadline() external {
        bytes32 fundedId = _create("actions-funded");
        vm.warp(escrow.agreementById(fundedId).deadline - 1);
        _assertActions(
            fundedId,
            address(this),
            _actions1(ICamEscrowView.AgreementAction.CancelAgreement)
        );
        _assertActions(
            fundedId,
            contractor,
            _actions1(ICamEscrowView.AgreementAction.AcceptAgreement)
        );
        _assertNoActions(fundedId, arbitrator);
        _assertNoActions(fundedId, unrelated);
        _assertNoActions(fundedId, address(0));
        _assertTimeoutActions(
            fundedId,
            ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout
        );

        bytes32 acceptedId = _create("actions-accepted");
        vm.prank(contractor);
        escrow.acceptAgreement(acceptedId);
        vm.warp(escrow.agreementById(acceptedId).deadline - 1);
        _assertNoActions(acceptedId, address(this));
        _assertActions(
            acceptedId,
            contractor,
            _actions1(ICamEscrowView.AgreementAction.SubmitAgreement)
        );
        _assertNoActions(acceptedId, arbitrator);
        _assertNoActions(acceptedId, unrelated);
        _assertTimeoutActions(acceptedId, ICamEscrowView.AgreementAction.FinalizeWorkTimeout);

        bytes32 submittedId = _create("actions-submitted");
        vm.prank(contractor);
        escrow.acceptAgreement(submittedId);
        vm.prank(contractor);
        escrow.submitAgreement(submittedId, _document("ipfs://submission", "submission"));
        vm.warp(escrow.agreementById(submittedId).deadline - 1);
        _assertActions(
            submittedId,
            address(this),
            _actions2(
                ICamEscrowView.AgreementAction.ApproveAgreement,
                ICamEscrowView.AgreementAction.DisputeAgreement
            )
        );
        _assertNoActions(submittedId, contractor);
        _assertNoActions(submittedId, arbitrator);
        _assertNoActions(submittedId, unrelated);
        _assertTimeoutActions(
            submittedId,
            ICamEscrowView.AgreementAction.FinalizeReviewTimeout
        );

        bytes32 disputedId = _create("actions-disputed");
        vm.prank(contractor);
        escrow.acceptAgreement(disputedId);
        vm.prank(contractor);
        escrow.submitAgreement(disputedId, _document("ipfs://submission-2", "submission-2"));
        escrow.disputeAgreement(disputedId, _document("ipfs://dispute", "dispute"));
        vm.warp(escrow.agreementById(disputedId).deadline - 1);
        _assertNoActions(disputedId, address(this));
        _assertNoActions(disputedId, contractor);
        _assertActions(
            disputedId,
            arbitrator,
            _actions2(
                ICamEscrowView.AgreementAction.ResolveForClient,
                ICamEscrowView.AgreementAction.ResolveForContractor
            )
        );
        _assertNoActions(disputedId, unrelated);
        _assertTimeoutActions(
            disputedId,
            ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout
        );
    }

    /// @notice State/actor/time legality is checked before evidence payload validity.
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

        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);

        vm.expectRevert(abi.encodeWithSelector(CamEscrow.InvalidDocumentURI.selector, 0));
        vm.prank(contractor);
        escrow.submitAgreement(agreementId, invalidDocument);
    }

    /// @notice Exact timeout functions cannot silently settle a later expired phase.
    function testStaleTimeoutFunctionCannotFinalizeAnotherPhase() external {
        bytes32 agreementId = _create("exact-timeout");
        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);

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
        assertEq(
            uint256(escrow.agreementById(agreementId).state),
            uint256(ICamEscrowView.AgreementState.RefundedAfterWorkTimeout)
        );
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
        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.NativeTransferFailed.selector, address(rejecting), 2 * AMOUNT)
        );
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

        assertEq(escrow.availableActions(agreementId, address(this)).length, 0);
        assertEq(escrow.availableActions(agreementId, unrelated).length, 0);

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

        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.InvalidWithdrawalRecipient.selector, address(0))
        );
        escrow.withdrawTo(payable(address(0)));

        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.InvalidWithdrawalRecipient.selector, address(escrow))
        );
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

        reentrant.accept(agreementId);
        reentrant.submit(agreementId, _document("ipfs://submission", "submission"));
        escrow.approveAgreement(agreementId);

        assertEq(escrow.withdrawable(address(reentrant)), AMOUNT);

        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.NativeTransferFailed.selector, address(reentrant), AMOUNT)
        );
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
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrow.DirectNativeTransferDisabled.selector))
        );

        bytes4 selector = bytes4(0x12345678);
        (ok, result) = address(escrow).call(abi.encodeWithSelector(selector));
        assertFalse(ok);
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrow.UnknownFunction.selector, selector))
        );

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

    function _create(string memory agreementRef) private returns (bytes32) {
        return escrow.createAgreement{value: AMOUNT}(_defaultParams(agreementRef));
    }

    function _defaultParams(string memory agreementRef)
        private
        view
        returns (CamEscrow.CreateAgreementParams memory params)
    {
        params.agreementRef = agreementRef;
        params.contractor = contractor;
        params.arbitrator = arbitrator;
        params.arbitrationTimeoutBeneficiary = ICamEscrowView.ArbitrationTimeoutBeneficiary.Client;
        params.amount = AMOUNT;
        params.acceptanceDuration = ACCEPTANCE_DURATION;
        params.workDuration = WORK_DURATION;
        params.reviewDuration = REVIEW_DURATION;
        params.arbitrationDuration = ARBITRATION_DURATION;
        params.terms = _document("ipfs://terms", "terms");
    }

    function _document(string memory uri, string memory seed)
        private
        pure
        returns (ICamEscrowView.DocumentRef memory)
    {
        return ICamEscrowView.DocumentRef({uri: uri, sha256Digest: sha256(bytes(seed))});
    }

    function _assertActions(
        bytes32 agreementId,
        address actor,
        ICamEscrowView.AgreementAction[] memory expected
    ) private view {
        ICamEscrowView.AgreementAction[] memory actual = escrow.availableActions(agreementId, actor);
        assertEq(actual.length, expected.length);
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(uint256(actual[i]), uint256(expected[i]));
        }
    }

    function _assertNoActions(bytes32 agreementId, address actor) private view {
        assertEq(escrow.availableActions(agreementId, actor).length, 0);
    }

    function _assertTimeoutActions(
        bytes32 agreementId,
        ICamEscrowView.AgreementAction timeoutAction
    ) private {
        uint256 deadline = escrow.agreementById(agreementId).deadline;
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

    function _actions2(
        ICamEscrowView.AgreementAction first,
        ICamEscrowView.AgreementAction second
    ) private pure returns (ICamEscrowView.AgreementAction[] memory actions) {
        actions = new ICamEscrowView.AgreementAction[](2);
        actions[0] = first;
        actions[1] = second;
    }

    function _actions1(ICamEscrowView.AgreementAction action)
        private
        pure
        returns (ICamEscrowView.AgreementAction[] memory actions)
    {
        actions = new ICamEscrowView.AgreementAction[](1);
        actions[0] = action;
    }

    function _stringOfLength(uint256 length) private pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            value[i] = 0x78;
        }
        return string(value);
    }
}
