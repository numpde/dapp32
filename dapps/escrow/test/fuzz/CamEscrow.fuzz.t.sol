pragma solidity 0.8.35;

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowTestBase} from "../support/CamEscrowTestBase.sol";

/// @notice Fuzz coverage for creation economics and action-observation equivalence.
contract CamEscrowFuzzTest is CamEscrowTestBase {
    struct ActionAttemptSnapshot {
        ICamEscrowView.AgreementView agreement;
        bool listed;
        uint256 escrowedBefore;
        uint256 withdrawableBefore;
    }

    /// @notice Arbitrary valid creation inputs preserve exact identity, state, deadline, and liabilities.
    function testFuzzCreationConservesIdentityAndLiability(
        uint96 amountSeed,
        uint256 durationSeed,
        uint8 referenceLengthSeed,
        bool timeoutToContractor
    ) external {
        uint256 amount = bound(uint256(amountSeed), 1, 100 ether);
        uint64 maximumDuration = escrow.MAX_PHASE_DURATION();
        uint256 referenceLength = bound(uint256(referenceLengthSeed), 1, escrow.MAX_AGREEMENT_REF_BYTES());
        string memory agreementRef = _stringOfLength(referenceLength);

        CamEscrow.CreateAgreementParams memory params = _defaultParams(agreementRef);
        params.amount = amount;
        params.acceptanceDuration = _boundedDuration(durationSeed, maximumDuration);
        params.workDuration = _boundedDuration(durationSeed >> 64, maximumDuration);
        params.reviewDuration = _boundedDuration(durationSeed >> 128, maximumDuration);
        params.arbitrationDuration = _boundedDuration(durationSeed >> 192, maximumDuration);
        params.arbitrationTimeoutBeneficiary = timeoutToContractor
            ? ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
            : ICamEscrowView.ArbitrationTimeoutBeneficiary.Client;

        bytes32 expectedId = keccak256(abi.encode(address(this), agreementRef));
        uint256 expectedDeadline = block.timestamp + params.acceptanceDuration;
        uint256 balanceBefore = address(escrow).balance;

        bytes32 agreementId = escrow.createAgreement{value: amount}(params);
        ICamEscrowView.AgreementView memory view_ = escrow.agreementById(agreementId);

        assertEq(agreementId, expectedId);
        assertEq(view_.agreementId, expectedId);
        assertEq(uint256(view_.state), uint256(ICamEscrowView.AgreementState.Funded));
        assertEq(view_.amount, amount);
        assertEq(view_.deadline, expectedDeadline);
        assertEq(view_.acceptanceDuration, params.acceptanceDuration);
        assertEq(view_.workDuration, params.workDuration);
        assertEq(view_.reviewDuration, params.reviewDuration);
        assertEq(view_.arbitrationDuration, params.arbitrationDuration);
        assertEq(address(escrow).balance, balanceBefore + amount);
        assertEq(escrow.totalEscrowed(), amount);
        assertEq(escrow.totalWithdrawable(), 0);
        assertEq(escrow.totalLiabilities(), amount);
    }

    /// @notice In Funded, every selected edge is listed exactly when its write guard succeeds.
    function testFuzzFundedActionsAgreeWithWrites(uint8 actorSeed, uint8 timeSeed, uint8 actionSeed) external {
        bytes32 agreementId = _create("fuzz-funded-actions");
        ICamEscrowView.AgreementAction action;
        uint256 selected = actionSeed % 3;
        if (selected == 0) action = ICamEscrowView.AgreementAction.CancelAgreement;
        else if (selected == 1) action = ICamEscrowView.AgreementAction.AcceptAgreement;
        else action = ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout;

        _assertActionObservationMatchesWrite(agreementId, action, _actor(actorSeed), timeSeed);
    }

    /// @notice In Accepted, submission and the exact work-timeout edge agree with observation.
    function testFuzzAcceptedActionsAgreeWithWrites(uint8 actorSeed, uint8 timeSeed, bool chooseTimeout) external {
        bytes32 agreementId = _create("fuzz-accepted-actions");
        _accept(agreementId);
        ICamEscrowView.AgreementAction action = chooseTimeout
            ? ICamEscrowView.AgreementAction.FinalizeWorkTimeout
            : ICamEscrowView.AgreementAction.SubmitAgreement;

        _assertActionObservationMatchesWrite(agreementId, action, _actor(actorSeed), timeSeed);
    }

    /// @notice In Submitted, both client choices and the exact review-timeout edge agree with observation.
    function testFuzzSubmittedActionsAgreeWithWrites(uint8 actorSeed, uint8 timeSeed, uint8 actionSeed) external {
        bytes32 agreementId = _create("fuzz-submitted-actions");
        _accept(agreementId);
        _submit(agreementId, "ipfs://fuzz-submission", "fuzz-submission");

        ICamEscrowView.AgreementAction action;
        uint256 selected = actionSeed % 3;
        if (selected == 0) action = ICamEscrowView.AgreementAction.ApproveAgreement;
        else if (selected == 1) action = ICamEscrowView.AgreementAction.DisputeAgreement;
        else action = ICamEscrowView.AgreementAction.FinalizeReviewTimeout;

        _assertActionObservationMatchesWrite(agreementId, action, _actor(actorSeed), timeSeed);
    }

    /// @notice In Disputed, both arbitrator rulings and the exact timeout edge agree with observation.
    function testFuzzDisputedActionsAgreeWithWrites(
        uint8 actorSeed,
        uint8 timeSeed,
        uint8 actionSeed,
        bool timeoutToContractor
    ) external {
        bytes32 agreementId = _create(
            "fuzz-disputed-actions",
            timeoutToContractor
                ? ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
                : ICamEscrowView.ArbitrationTimeoutBeneficiary.Client
        );
        _acceptSubmitAndDispute(agreementId);

        ICamEscrowView.AgreementAction action;
        uint256 selected = actionSeed % 3;
        if (selected == 0) action = ICamEscrowView.AgreementAction.ResolveForClient;
        else if (selected == 1) action = ICamEscrowView.AgreementAction.ResolveForContractor;
        else action = ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout;

        _assertActionObservationMatchesWrite(agreementId, action, _actor(actorSeed), timeSeed);
    }

    /// @notice Arbitrary valid amounts retain a single full-credit arbitration-timeout outcome.
    function testFuzzArbitrationTimeoutCreditsOnlyConfiguredParty(
        uint96 amountSeed,
        uint64 durationSeed,
        uint8 finalizerSeed,
        bool timeoutToContractor
    ) external {
        uint256 amount = bound(uint256(amountSeed), 1, 100 ether);
        uint64 duration = uint64(bound(uint256(durationSeed), 1, escrow.MAX_PHASE_DURATION()));
        CamEscrow.CreateAgreementParams memory params = _defaultParams("fuzz-timeout-beneficiary");
        params.amount = amount;
        params.acceptanceDuration = duration;
        params.workDuration = duration;
        params.reviewDuration = duration;
        params.arbitrationDuration = duration;
        params.arbitrationTimeoutBeneficiary = timeoutToContractor
            ? ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
            : ICamEscrowView.ArbitrationTimeoutBeneficiary.Client;

        bytes32 agreementId = escrow.createAgreement{value: amount}(params);
        _accept(agreementId);
        _submit(agreementId, "ipfs://fuzz-timeout-submission", "fuzz-timeout-submission");
        _dispute(agreementId, "ipfs://fuzz-timeout-dispute", "fuzz-timeout-dispute");
        _warpToDeadline(agreementId);

        vm.prank(_actor(finalizerSeed));
        escrow.finalizeArbitrationTimeout(agreementId);

        address beneficiary = timeoutToContractor ? contractor : address(this);
        address otherParty = timeoutToContractor ? address(this) : contractor;
        ICamEscrowView.AgreementState expectedState = timeoutToContractor
            ? ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout
            : ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout;

        _assertState(agreementId, expectedState);
        assertEq(escrow.withdrawable(beneficiary), amount);
        assertEq(escrow.withdrawable(otherParty), 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalWithdrawable(), amount);
        assertEq(escrow.totalLiabilities(), amount);
    }

    function _assertActionObservationMatchesWrite(
        bytes32 agreementId,
        ICamEscrowView.AgreementAction action,
        address actor,
        uint8 timeSeed
    ) private {
        _warpRelativeToDeadline(agreementId, timeSeed);
        ActionAttemptSnapshot memory snapshot;
        snapshot.agreement = escrow.agreementById(agreementId);
        snapshot.listed = _containsAction(escrow.availableActions(agreementId, actor), action);
        snapshot.escrowedBefore = escrow.totalEscrowed();
        snapshot.withdrawableBefore = escrow.totalWithdrawable();
        bytes memory callData = _actionCallData(action, agreementId);

        vm.prank(actor);
        (bool ok,) = address(escrow).call(callData);
        assertEq(ok, snapshot.listed, "availableActions/write guard disagreement");

        ICamEscrowView.AgreementView memory after_ = escrow.agreementById(agreementId);
        if (!ok) {
            assertEq(uint256(after_.state), uint256(snapshot.agreement.state));
            assertEq(after_.deadline, snapshot.agreement.deadline);
            assertEq(escrow.totalEscrowed(), snapshot.escrowedBefore);
            assertEq(escrow.totalWithdrawable(), snapshot.withdrawableBefore);
            return;
        }

        ICamEscrowView.AgreementState expectedState = _targetState(snapshot.agreement, action);
        assertEq(uint256(after_.state), uint256(expectedState));
        if (_isTerminal(expectedState)) assertEq(after_.deadline, 0);
        else assertGt(after_.deadline, 0);
    }

    function _warpRelativeToDeadline(bytes32 agreementId, uint8 timeSeed) private {
        uint256 deadline = escrow.agreementById(agreementId).deadline;
        uint256 position = timeSeed % 3;
        if (position == 0) vm.warp(deadline - 1);
        else if (position == 1) vm.warp(deadline);
        else vm.warp(deadline + 1);
    }

    function _actor(uint8 seed) private view returns (address) {
        uint256 selected = seed % 4;
        if (selected == 0) return address(this);
        if (selected == 1) return contractor;
        if (selected == 2) return arbitrator;
        return unrelated;
    }

    function _actionCallData(ICamEscrowView.AgreementAction action, bytes32 agreementId)
        private
        pure
        returns (bytes memory)
    {
        if (action == ICamEscrowView.AgreementAction.CancelAgreement) {
            return abi.encodeWithSelector(CamEscrow.cancelAgreement.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.AcceptAgreement) {
            return abi.encodeWithSelector(CamEscrow.acceptAgreement.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.SubmitAgreement) {
            return abi.encodeWithSelector(
                CamEscrow.submitAgreement.selector,
                agreementId,
                ICamEscrowView.DocumentRef({
                    uri: "ipfs://fuzz-action-submission", sha256Digest: sha256(bytes("fuzz-action-submission"))
                })
            );
        }
        if (action == ICamEscrowView.AgreementAction.ApproveAgreement) {
            return abi.encodeWithSelector(CamEscrow.approveAgreement.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.DisputeAgreement) {
            return abi.encodeWithSelector(
                CamEscrow.disputeAgreement.selector,
                agreementId,
                ICamEscrowView.DocumentRef({
                    uri: "ipfs://fuzz-action-dispute", sha256Digest: sha256(bytes("fuzz-action-dispute"))
                })
            );
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout) {
            return abi.encodeWithSelector(CamEscrow.finalizeAcceptanceTimeout.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeWorkTimeout) {
            return abi.encodeWithSelector(CamEscrow.finalizeWorkTimeout.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeReviewTimeout) {
            return abi.encodeWithSelector(CamEscrow.finalizeReviewTimeout.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForClient) {
            return abi.encodeWithSelector(CamEscrow.resolveForClient.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForContractor) {
            return abi.encodeWithSelector(CamEscrow.resolveForContractor.selector, agreementId);
        }
        return abi.encodeWithSelector(CamEscrow.finalizeArbitrationTimeout.selector, agreementId);
    }

    function _targetState(ICamEscrowView.AgreementView memory agreement, ICamEscrowView.AgreementAction action)
        private
        pure
        returns (ICamEscrowView.AgreementState)
    {
        if (action == ICamEscrowView.AgreementAction.CancelAgreement) {
            return ICamEscrowView.AgreementState.CancelledByClient;
        }
        if (action == ICamEscrowView.AgreementAction.AcceptAgreement) {
            return ICamEscrowView.AgreementState.Accepted;
        }
        if (action == ICamEscrowView.AgreementAction.SubmitAgreement) {
            return ICamEscrowView.AgreementState.Submitted;
        }
        if (action == ICamEscrowView.AgreementAction.ApproveAgreement) {
            return ICamEscrowView.AgreementState.ReleasedByClientApproval;
        }
        if (action == ICamEscrowView.AgreementAction.DisputeAgreement) {
            return ICamEscrowView.AgreementState.Disputed;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout) {
            return ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeWorkTimeout) {
            return ICamEscrowView.AgreementState.RefundedAfterWorkTimeout;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeReviewTimeout) {
            return ICamEscrowView.AgreementState.ReleasedAfterReviewTimeout;
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForClient) {
            return ICamEscrowView.AgreementState.RefundedByArbitrator;
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForContractor) {
            return ICamEscrowView.AgreementState.ReleasedByArbitrator;
        }
        return agreement.arbitrationTimeoutBeneficiary == ICamEscrowView.ArbitrationTimeoutBeneficiary.Client
            ? ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout
            : ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout;
    }

    function _containsAction(ICamEscrowView.AgreementAction[] memory actions, ICamEscrowView.AgreementAction expected)
        private
        pure
        returns (bool)
    {
        for (uint256 i = 0; i < actions.length; i++) {
            if (actions[i] == expected) return true;
        }
        return false;
    }

    function _boundedDuration(uint256 seed, uint64 maximum) private pure returns (uint64) {
        return uint64((seed % maximum) + 1);
    }

    function _isTerminal(ICamEscrowView.AgreementState state) private pure returns (bool) {
        return uint256(state) > uint256(ICamEscrowView.AgreementState.Disputed);
    }
}
