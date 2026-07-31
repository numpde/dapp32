pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";

/// @dev Empty contract used to prove that contract accounts are valid escrow roles.
contract EscrowRoleContract {}

/// @notice Deterministic policy and validation boundaries separated from the core unit file after concrete file pressure.
contract CamEscrowPolicyTest is Test {
    uint256 private constant AMOUNT = 10 ether;
    uint64 private constant ACCEPTANCE_DURATION = 2 days;
    uint64 private constant WORK_DURATION = 3 days;
    uint64 private constant REVIEW_DURATION = 4 days;
    uint64 private constant ARBITRATION_DURATION = 5 days;

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

    /// @notice The advertised byte caps are inclusive and oversized document locators fail without creating liability.
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

        ICamEscrowView.AgreementAction[] memory actions =
            escrow.availableActions(agreementId, finalizer);
        assertEq(actions.length, 1);
        assertEq(
            uint256(actions[0]),
            uint256(ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout)
        );

        vm.prank(finalizer);
        escrow.finalizeAcceptanceTimeout(agreementId);
        assertEq(
            uint256(escrow.agreementById(agreementId).state),
            uint256(ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout)
        );
        assertEq(escrow.withdrawable(address(this)), AMOUNT);
    }

    /// @notice Acceptance and cancellation are ordered solely by the first confirmed state-changing transaction.
    function testAcceptanceAndCancellationRaceBothResolveByTransactionOrder() external {
        bytes32 acceptedFirst = _create("accepted-first");
        vm.prank(contractor);
        escrow.acceptAgreement(acceptedFirst);

        vm.expectRevert(CamEscrow.ActionUnavailable.selector);
        escrow.cancelAgreement(acceptedFirst);
        assertEq(
            uint256(escrow.agreementById(acceptedFirst).state),
            uint256(ICamEscrowView.AgreementState.Accepted)
        );

        bytes32 cancelledFirst = _create("cancelled-first");
        escrow.cancelAgreement(cancelledFirst);

        vm.expectRevert(CamEscrow.ActionUnavailable.selector);
        vm.prank(contractor);
        escrow.acceptAgreement(cancelledFirst);
        assertEq(
            uint256(escrow.agreementById(cancelledFirst).state),
            uint256(ICamEscrowView.AgreementState.CancelledByClient)
        );
    }

    /// @notice A dispute at the final review second starts a fresh, nearly complete arbitration interval.
    function testLastMomentDisputeStartsTheFullArbitrationWindow() external {
        bytes32 agreementId = _create("last-moment-dispute");
        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);
        vm.prank(contractor);
        escrow.submitAgreement(
            agreementId, _document("ipfs://submission", "last-moment-submission")
        );

        uint256 reviewDeadline = escrow.agreementById(agreementId).deadline;
        vm.warp(reviewDeadline - 1);
        escrow.disputeAgreement(
            agreementId, _document("ipfs://dispute", "last-moment-dispute")
        );

        ICamEscrowView.AgreementView memory disputed = escrow.agreementById(agreementId);
        assertEq(uint256(disputed.state), uint256(ICamEscrowView.AgreementState.Disputed));
        assertEq(disputed.deadline, reviewDeadline - 1 + ARBITRATION_DURATION);

        vm.warp(reviewDeadline);
        ICamEscrowView.AgreementAction[] memory arbitratorActions =
            escrow.availableActions(agreementId, arbitrator);
        assertEq(arbitratorActions.length, 2);
        assertEq(
            uint256(arbitratorActions[0]),
            uint256(ICamEscrowView.AgreementAction.ResolveForClient)
        );
        assertEq(
            uint256(arbitratorActions[1]),
            uint256(ICamEscrowView.AgreementAction.ResolveForContractor)
        );

        vm.expectRevert(CamEscrow.ActionUnavailable.selector);
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
        params.arbitrationTimeoutBeneficiary =
            ICamEscrowView.ArbitrationTimeoutBeneficiary.Client;
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

    function _stringOfLength(uint256 length) private pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            value[i] = 0x78;
        }
        return string(value);
    }
}
