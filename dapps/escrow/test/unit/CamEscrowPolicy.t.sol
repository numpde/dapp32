pragma solidity 0.8.35;

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowTestBase} from "../support/CamEscrowTestBase.sol";

/// @dev Empty contract used to prove that contract accounts are valid escrow roles.
contract EscrowRoleContract {}

/// @notice Deterministic policy and validation boundaries for the V1 escrow.
contract CamEscrowPolicyTest is CamEscrowTestBase {
    /// @notice The advertised byte caps are inclusive and oversized document locators create no liability.
    function testReferenceAndDocumentBoundsAreInclusive() external {
        CamEscrow.CreateAgreementParams memory params =
            _defaultParams(_stringOfLength(escrow.MAX_AGREEMENT_REF_BYTES()));
        params.terms.uri = _stringOfLength(escrow.MAX_DOCUMENT_URI_BYTES());

        bytes32 agreementId = escrow.createAgreement{value: AMOUNT}(params);
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);

        assertEq(bytes(view_.agreementRef).length, escrow.MAX_AGREEMENT_REF_BYTES());
        assertEq(bytes(view_.terms.uri).length, escrow.MAX_DOCUMENT_URI_BYTES());
        assertEq(escrow.totalLiabilities(), AMOUNT);

        params = _defaultParams("oversized-document");
        params.terms.uri = _stringOfLength(escrow.MAX_DOCUMENT_URI_BYTES() + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidDocumentURI.selector, escrow.MAX_DOCUMENT_URI_BYTES() + 1
            )
        );
        escrow.createAgreement{value: AMOUNT}(params);

        assertEq(escrow.totalLiabilities(), AMOUNT);
    }

    /// @notice Every forbidden address relation is rejected, while distinct contract accounts remain valid roles.
    function testPartyConfigurationCoversEveryForbiddenRelationAndAllowsContracts() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("zero-contractor");
        params.contractor = address(0);
        _expectInvalidParties(params, address(0), arbitrator);

        params = _defaultParams("zero-arbitrator");
        params.arbitrator = address(0);
        _expectInvalidParties(params, contractor, address(0));

        params = _defaultParams("client-contractor");
        params.contractor = address(this);
        _expectInvalidParties(params, address(this), arbitrator);

        params = _defaultParams("client-arbitrator");
        params.arbitrator = address(this);
        _expectInvalidParties(params, contractor, address(this));

        params = _defaultParams("contractor-arbitrator");
        params.arbitrator = contractor;
        _expectInvalidParties(params, contractor, contractor);

        params = _defaultParams("escrow-contractor");
        params.contractor = address(escrow);
        _expectInvalidParties(params, address(escrow), arbitrator);

        params = _defaultParams("escrow-arbitrator");
        params.arbitrator = address(escrow);
        _expectInvalidParties(params, contractor, address(escrow));

        EscrowRoleContract contractContractor = new EscrowRoleContract();
        EscrowRoleContract contractArbitrator = new EscrowRoleContract();
        params = _defaultParams("contract-roles");
        params.contractor = address(contractContractor);
        params.arbitrator = address(contractArbitrator);

        bytes32 agreementId = escrow.createAgreement{value: AMOUNT}(params);
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);
        assertEq(view_.contractor, address(contractContractor));
        assertEq(view_.arbitrator, address(contractArbitrator));
    }

    /// @notice Native value must match exactly, and every phase duration accepts its cap but rejects zero and cap-plus-one.
    function testExactValueAndEveryDurationBoundary() external {
        CamEscrow.CreateAgreementParams memory params = _defaultParams("overpaid");
        vm.expectRevert(
            abi.encodeWithSelector(CamEscrow.NativeAmountMismatch.selector, AMOUNT, AMOUNT + 1)
        );
        escrow.createAgreement{value: AMOUNT + 1}(params);

        uint64 maximum = escrow.MAX_PHASE_DURATION();
        params = _defaultParams("maximum-durations");
        params.acceptanceDuration = maximum;
        params.workDuration = maximum;
        params.reviewDuration = maximum;
        params.arbitrationDuration = maximum;
        escrow.createAgreement{value: AMOUNT}(params);

        params = _defaultParams("acceptance-zero");
        params.acceptanceDuration = 0;
        _expectDurationError(
            params, CamEscrow.InvalidAcceptanceDuration.selector, params.acceptanceDuration
        );

        params = _defaultParams("acceptance-large");
        params.acceptanceDuration = maximum + 1;
        _expectDurationError(
            params, CamEscrow.InvalidAcceptanceDuration.selector, params.acceptanceDuration
        );

        params = _defaultParams("work-zero");
        params.workDuration = 0;
        _expectDurationError(params, CamEscrow.InvalidWorkDuration.selector, params.workDuration);

        params = _defaultParams("work-large");
        params.workDuration = maximum + 1;
        _expectDurationError(params, CamEscrow.InvalidWorkDuration.selector, params.workDuration);

        params = _defaultParams("review-zero");
        params.reviewDuration = 0;
        _expectDurationError(params, CamEscrow.InvalidReviewDuration.selector, params.reviewDuration);

        params = _defaultParams("review-large");
        params.reviewDuration = maximum + 1;
        _expectDurationError(params, CamEscrow.InvalidReviewDuration.selector, params.reviewDuration);

        params = _defaultParams("arbitration-zero");
        params.arbitrationDuration = 0;
        _expectDurationError(
            params, CamEscrow.InvalidArbitrationDuration.selector, params.arbitrationDuration
        );

        params = _defaultParams("arbitration-large");
        params.arbitrationDuration = maximum + 1;
        _expectDurationError(
            params, CamEscrow.InvalidArbitrationDuration.selector, params.arbitrationDuration
        );

        assertEq(escrow.totalLiabilities(), AMOUNT);
    }

    /// @notice Lookup is total over arbitrary reference bytes even when those bytes could not be used for creation.
    function testReferenceLookupDoesNotApplyCreationLengthPolicy() external view {
        string memory nonCreatableReference =
            _stringOfLength(escrow.MAX_AGREEMENT_REF_BYTES() + 1);
        bytes32 expectedId = keccak256(abi.encode(address(this), nonCreatableReference));

        ICamEscrowView.AgreementView memory view_ =
            escrow.agreementByReference(address(this), nonCreatableReference);

        assertEq(view_.agreementId, expectedId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.None));
    }

    /// @notice Passing a deadline does not mutate storage or liabilities until an explicit timeout transaction succeeds.
    function testTimeoutSettlementRequiresAnExplicitTransaction() external {
        bytes32 agreementId = _create("manual-timeout");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline + 30 days);

        ICamEscrowView.AgreementView memory expired = escrow.agreementById(agreementId);
        assertEq(uint256(expired.state), uint256(ICamEscrowView.AgreementState.Funded));
        assertEq(expired.deadline, deadline);
        assertEq(escrow.totalEscrowed(), AMOUNT);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.withdrawable(address(this)), 0);

        _assertActions(
            agreementId,
            finalizer,
            _actions1(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout)
        );

        vm.prank(finalizer);
        escrow.finalizeAcceptanceTimeout(agreementId);
        _assertState(
            agreementId, ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout
        );
        assertEq(escrow.withdrawable(address(this)), AMOUNT);
    }

    /// @notice Acceptance and cancellation are ordered solely by the first confirmed state-changing transaction.
    function testAcceptanceAndCancellationRaceBothResolveByTransactionOrder() external {
        bytes32 acceptedFirst = _create("accepted-first");
        _accept(acceptedFirst);

        ICamEscrowView.AgreementView memory accepted = escrow.agreementById(acceptedFirst);
        uint256 acceptedNow = block.timestamp;
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                acceptedFirst,
                ICamEscrowView.AgreementAction.CancelAgreement,
                address(this),
                ICamEscrowView.AgreementState.Accepted,
                accepted.deadline,
                acceptedNow
            )
        );
        escrow.cancelAgreement(acceptedFirst);
        _assertState(acceptedFirst, ICamEscrowView.AgreementState.Accepted);

        bytes32 cancelledFirst = _create("cancelled-first");
        escrow.cancelAgreement(cancelledFirst);

        ICamEscrowView.AgreementView memory cancelled = escrow.agreementById(cancelledFirst);
        uint256 cancelledNow = block.timestamp;
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                cancelledFirst,
                ICamEscrowView.AgreementAction.AcceptAgreement,
                contractor,
                ICamEscrowView.AgreementState.CancelledByClient,
                cancelled.deadline,
                cancelledNow
            )
        );
        vm.prank(contractor);
        escrow.acceptAgreement(cancelledFirst);
        _assertState(cancelledFirst, ICamEscrowView.AgreementState.CancelledByClient);
    }

    /// @notice A dispute at the final review second starts a fresh, nearly complete arbitration interval.
    function testLastMomentDisputeStartsTheFullArbitrationWindow() external {
        bytes32 agreementId = _create("last-moment-dispute");
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "last-moment-submission");

        uint256 reviewDeadline = escrow.agreementById(agreementId).deadline;
        vm.warp(reviewDeadline - 1);
        _dispute(agreementId, "ipfs://dispute", "last-moment-dispute");

        ICamEscrowView.AgreementView memory disputed = escrow.agreementById(agreementId);
        assertEq(uint256(disputed.state), uint256(ICamEscrowView.AgreementState.Disputed));
        assertEq(disputed.deadline, reviewDeadline - 1 + ARBITRATION_DURATION);

        vm.warp(reviewDeadline);
        _assertActions(
            agreementId,
            arbitrator,
            _actions2(
                ICamEscrowView.AgreementAction.ResolveForClient,
                ICamEscrowView.AgreementAction.ResolveForContractor
            )
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.ActionUnavailable.selector,
                agreementId,
                ICamEscrowView.AgreementAction.FinalizeReviewTimeout,
                finalizer,
                ICamEscrowView.AgreementState.Disputed,
                disputed.deadline,
                reviewDeadline
            )
        );
        vm.prank(finalizer);
        escrow.finalizeReviewTimeout(agreementId);
    }

    function _expectInvalidParties(
        CamEscrow.CreateAgreementParams memory params,
        address expectedContractor,
        address expectedArbitrator
    ) private {
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrow.InvalidPartyConfiguration.selector,
                address(this),
                expectedContractor,
                expectedArbitrator
            )
        );
        escrow.createAgreement{value: AMOUNT}(params);
    }

    function _expectDurationError(
        CamEscrow.CreateAgreementParams memory params,
        bytes4 selector,
        uint64 duration
    ) private {
        vm.expectRevert(abi.encodeWithSelector(selector, duration));
        escrow.createAgreement{value: AMOUNT}(params);
    }
}
