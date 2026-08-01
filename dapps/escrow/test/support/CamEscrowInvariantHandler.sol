pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";

/// @notice Stateful action driver for CamEscrow invariants.
/// @dev The handler does not reproduce the state machine. It asks
/// `availableActions` whether an edge is enabled, executes that exact edge, and
/// checks the emitted state-change witness against the resulting observation.
contract CamEscrowInvariantHandler is Test {
    uint256 private constant MAX_TRACKED_AGREEMENTS = 16;
    uint256 private constant ACTOR_COUNT = 8;
    uint256 private constant MAX_AMOUNT = 10 ether;
    uint64 private constant MAX_TEST_DURATION = 14 days;

    struct TrackedAgreement {
        bytes32 agreementId;
        address client;
        address contractor;
        address arbitrator;
        uint256 amount;
    }

    struct CreationCase {
        address client;
        address contractor;
        address arbitrator;
        uint256 amount;
        uint256 sequence;
        string agreementRef;
        CamEscrow.CreateAgreementParams params;
    }

    struct TransitionSnapshot {
        ICamEscrowView.AgreementView agreement;
        ICamEscrowView.AgreementState targetState;
        uint256 targetDeadline;
        address beneficiary;
        uint256 escrowedBefore;
        uint256 withdrawableBefore;
        uint256 beneficiaryCreditBefore;
    }

    CamEscrow public immutable escrow;

    TrackedAgreement[] private _agreements;
    address[] private _actors;

    uint256 public totalCreated;
    uint256 public totalWithdrawn;

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

    constructor(CamEscrow escrow_) {
        escrow = escrow_;
        for (uint256 i = 0; i < ACTOR_COUNT; i++) {
            _actors.push(address(uint160(0x1000 + i)));
        }
    }

    /// @notice Creates bounded, uniquely keyed agreements across a fixed actor pool.
    function createAgreement(uint256 roleSeed, uint96 amountSeed, uint64 durationSeed, bool timeoutToContractor)
        external
    {
        if (_agreements.length >= MAX_TRACKED_AGREEMENTS) return;

        CreationCase memory case_ = _creationCase(roleSeed, amountSeed, durationSeed, timeoutToContractor);
        bytes32 agreementId = keccak256(abi.encode(case_.client, case_.agreementRef));
        uint256 deadline = block.timestamp + case_.params.acceptanceDuration;

        vm.expectEmit(true, true, true, true, address(escrow));
        emit AgreementCreated(agreementId, case_.client, case_.contractor, case_.arbitrator, case_.amount, deadline);

        vm.prank(case_.client);
        bytes32 returnedId = escrow.createAgreement{value: case_.amount}(case_.params);
        assertEq(returnedId, agreementId);

        _agreements.push(
            TrackedAgreement({
                agreementId: agreementId,
                client: case_.client,
                contractor: case_.contractor,
                arbitrator: case_.arbitrator,
                amount: case_.amount
            })
        );
        totalCreated += case_.amount;
    }

    function cancelAgreement(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.CancelAgreement,
            tracked.client,
            abi.encodeWithSelector(CamEscrow.cancelAgreement.selector, tracked.agreementId)
        );
    }

    function acceptAgreement(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.AcceptAgreement,
            tracked.contractor,
            abi.encodeWithSelector(CamEscrow.acceptAgreement.selector, tracked.agreementId)
        );
    }

    function submitAgreement(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        ICamEscrowView.DocumentRef memory submission = _document("submission", tracked.agreementId, seed);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.SubmitAgreement,
            tracked.contractor,
            abi.encodeWithSelector(CamEscrow.submitAgreement.selector, tracked.agreementId, submission)
        );
    }

    function approveAgreement(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.ApproveAgreement,
            tracked.client,
            abi.encodeWithSelector(CamEscrow.approveAgreement.selector, tracked.agreementId)
        );
    }

    function disputeAgreement(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        ICamEscrowView.DocumentRef memory dispute = _document("dispute", tracked.agreementId, seed);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.DisputeAgreement,
            tracked.client,
            abi.encodeWithSelector(CamEscrow.disputeAgreement.selector, tracked.agreementId, dispute)
        );
    }

    function finalizeAcceptanceTimeout(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        address actor = _actor(seed >> 8);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout,
            actor,
            abi.encodeWithSelector(CamEscrow.finalizeAcceptanceTimeout.selector, tracked.agreementId)
        );
    }

    function finalizeWorkTimeout(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        address actor = _actor(seed >> 8);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.FinalizeWorkTimeout,
            actor,
            abi.encodeWithSelector(CamEscrow.finalizeWorkTimeout.selector, tracked.agreementId)
        );
    }

    function finalizeReviewTimeout(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        address actor = _actor(seed >> 8);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.FinalizeReviewTimeout,
            actor,
            abi.encodeWithSelector(CamEscrow.finalizeReviewTimeout.selector, tracked.agreementId)
        );
    }

    function resolveForClient(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.ResolveForClient,
            tracked.arbitrator,
            abi.encodeWithSelector(CamEscrow.resolveForClient.selector, tracked.agreementId)
        );
    }

    function resolveForContractor(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.ResolveForContractor,
            tracked.arbitrator,
            abi.encodeWithSelector(CamEscrow.resolveForContractor.selector, tracked.agreementId)
        );
    }

    function finalizeArbitrationTimeout(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        address actor = _actor(seed >> 8);
        _performIfAvailable(
            tracked,
            ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout,
            actor,
            abi.encodeWithSelector(CamEscrow.finalizeArbitrationTimeout.selector, tracked.agreementId)
        );
    }

    /// @notice Advances time monotonically so all timeout phases are exercised.
    function advanceTime(uint32 deltaSeed) external {
        vm.warp(block.timestamp + bound(uint256(deltaSeed), 1, MAX_TEST_DURATION));
    }

    /// @notice Withdraws an actor's complete aggregate credit to a non-role sink.
    function withdrawCredit(uint256 seed) external {
        address account = _actor(seed);
        uint256 amount = escrow.withdrawable(account);
        if (amount == 0) return;

        address payable recipient = payable(address(uint160(0x9000 + ((seed >> 8) % 16))));
        uint256 recipientBalanceBefore = recipient.balance;

        vm.expectEmit(true, true, false, true, address(escrow));
        emit Withdrawal(account, recipient, amount);

        vm.prank(account);
        escrow.withdrawTo(recipient);

        totalWithdrawn += amount;
        assertEq(recipient.balance, recipientBalanceBefore + amount);
    }

    /// @notice Random terminal writes must all fail without changing state or liabilities.
    function probeTerminalIrreversibility(uint256 seed) external {
        if (_agreements.length == 0) return;
        TrackedAgreement storage tracked = _agreements[seed % _agreements.length];
        ICamEscrowView.AgreementView memory before_ = escrow.agreementById(tracked.agreementId);
        if (!_isTerminal(before_.state)) return;

        ICamEscrowView.AgreementAction action = ICamEscrowView.AgreementAction(
            (seed >> 8) % (uint256(ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout) + 1)
        );
        address actor = _actor(seed >> 16);
        bytes memory callData = _actionCallData(action, tracked.agreementId, seed);
        uint256 escrowedBefore = escrow.totalEscrowed();
        uint256 withdrawableBefore = escrow.totalWithdrawable();

        vm.prank(actor);
        (bool ok,) = address(escrow).call(callData);
        assertFalse(ok);

        ICamEscrowView.AgreementView memory after_ = escrow.agreementById(tracked.agreementId);
        assertEq(uint256(after_.state), uint256(before_.state));
        assertEq(after_.deadline, before_.deadline);
        assertEq(escrow.totalEscrowed(), escrowedBefore);
        assertEq(escrow.totalWithdrawable(), withdrawableBefore);
    }

    function agreementCount() external view returns (uint256) {
        return _agreements.length;
    }

    function agreementAt(uint256 index) external view returns (TrackedAgreement memory) {
        return _agreements[index];
    }

    function actorCount() external view returns (uint256) {
        return _actors.length;
    }

    function actorAt(uint256 index) external view returns (address) {
        return _actors[index];
    }

    function _creationCase(uint256 roleSeed, uint96 amountSeed, uint64 durationSeed, bool timeoutToContractor)
        private
        returns (CreationCase memory case_)
    {
        (case_.client, case_.contractor, case_.arbitrator) = _roles(roleSeed);
        case_.amount = bound(uint256(amountSeed), 1, MAX_AMOUNT);
        case_.sequence = _agreements.length;
        case_.agreementRef = string.concat("invariant-", vm.toString(case_.sequence));

        case_.params.agreementRef = case_.agreementRef;
        case_.params.contractor = case_.contractor;
        case_.params.arbitrator = case_.arbitrator;
        case_.params.arbitrationTimeoutBeneficiary = timeoutToContractor
            ? ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
            : ICamEscrowView.ArbitrationTimeoutBeneficiary.Client;
        case_.params.amount = case_.amount;
        case_.params.acceptanceDuration = _duration(durationSeed);
        case_.params.workDuration = _duration(durationSeed >> 8);
        case_.params.reviewDuration = _duration(durationSeed >> 16);
        case_.params.arbitrationDuration = _duration(durationSeed >> 24);
        case_.params.terms = ICamEscrowView.DocumentRef({
            uri: string.concat("ipfs://terms/", vm.toString(case_.sequence)),
            sha256Digest: sha256(abi.encodePacked("terms", case_.sequence))
        });
    }

    function _roles(uint256 seed) private view returns (address client, address contractor, address arbitrator) {
        uint256 clientIndex = seed % ACTOR_COUNT;
        uint256 contractorIndex = (clientIndex + 1 + ((seed >> 8) % (ACTOR_COUNT - 1))) % ACTOR_COUNT;
        uint256 arbitratorIndex = (clientIndex + 1 + ((seed >> 16) % (ACTOR_COUNT - 1))) % ACTOR_COUNT;
        while (arbitratorIndex == clientIndex || arbitratorIndex == contractorIndex) {
            arbitratorIndex = (arbitratorIndex + 1) % ACTOR_COUNT;
        }

        client = _actors[clientIndex];
        contractor = _actors[contractorIndex];
        arbitrator = _actors[arbitratorIndex];
    }

    function _performIfAvailable(
        TrackedAgreement storage tracked,
        ICamEscrowView.AgreementAction action,
        address actor,
        bytes memory callData
    ) private {
        if (!_containsAction(escrow.availableActions(tracked.agreementId, actor), action)) return;

        TransitionSnapshot memory snapshot = _transitionSnapshot(tracked.agreementId, action);

        vm.expectEmit(true, true, false, true, address(escrow));
        emit AgreementStateChanged(
            tracked.agreementId, actor, snapshot.agreement.state, snapshot.targetState, snapshot.targetDeadline
        );

        vm.prank(actor);
        (bool ok,) = address(escrow).call(callData);
        assertTrue(ok);

        _assertTransitionAfter(tracked.agreementId, snapshot);
    }

    function _transitionSnapshot(bytes32 agreementId, ICamEscrowView.AgreementAction action)
        private
        view
        returns (TransitionSnapshot memory snapshot)
    {
        snapshot.agreement = escrow.agreementById(agreementId);
        snapshot.targetState = _targetState(snapshot.agreement, action);
        snapshot.targetDeadline = _targetDeadline(snapshot.agreement, action);
        snapshot.beneficiary = _beneficiary(snapshot.agreement, action);
        snapshot.escrowedBefore = escrow.totalEscrowed();
        snapshot.withdrawableBefore = escrow.totalWithdrawable();
        if (snapshot.beneficiary != address(0)) {
            snapshot.beneficiaryCreditBefore = escrow.withdrawable(snapshot.beneficiary);
        }
    }

    function _assertTransitionAfter(bytes32 agreementId, TransitionSnapshot memory snapshot) private view {
        ICamEscrowView.AgreementView memory after_ = escrow.agreementById(agreementId);
        assertEq(uint256(after_.state), uint256(snapshot.targetState));
        assertEq(after_.deadline, snapshot.targetDeadline);

        if (snapshot.beneficiary == address(0)) {
            assertEq(escrow.totalEscrowed(), snapshot.escrowedBefore);
            assertEq(escrow.totalWithdrawable(), snapshot.withdrawableBefore);
            return;
        }

        assertEq(escrow.totalEscrowed(), snapshot.escrowedBefore - snapshot.agreement.amount);
        assertEq(escrow.totalWithdrawable(), snapshot.withdrawableBefore + snapshot.agreement.amount);
        assertEq(
            escrow.withdrawable(snapshot.beneficiary), snapshot.beneficiaryCreditBefore + snapshot.agreement.amount
        );
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
        if (agreement.arbitrationTimeoutBeneficiary == ICamEscrowView.ArbitrationTimeoutBeneficiary.Client) {
            return ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout;
        }
        return ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout;
    }

    function _targetDeadline(ICamEscrowView.AgreementView memory agreement, ICamEscrowView.AgreementAction action)
        private
        view
        returns (uint256)
    {
        if (action == ICamEscrowView.AgreementAction.AcceptAgreement) {
            return block.timestamp + agreement.workDuration;
        }
        if (action == ICamEscrowView.AgreementAction.SubmitAgreement) {
            return block.timestamp + agreement.reviewDuration;
        }
        if (action == ICamEscrowView.AgreementAction.DisputeAgreement) {
            return block.timestamp + agreement.arbitrationDuration;
        }
        return 0;
    }

    function _beneficiary(ICamEscrowView.AgreementView memory agreement, ICamEscrowView.AgreementAction action)
        private
        pure
        returns (address)
    {
        if (
            action == ICamEscrowView.AgreementAction.AcceptAgreement
                || action == ICamEscrowView.AgreementAction.SubmitAgreement
                || action == ICamEscrowView.AgreementAction.DisputeAgreement
        ) {
            return address(0);
        }
        if (
            action == ICamEscrowView.AgreementAction.CancelAgreement
                || action == ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout
                || action == ICamEscrowView.AgreementAction.FinalizeWorkTimeout
                || action == ICamEscrowView.AgreementAction.ResolveForClient
        ) {
            return agreement.client;
        }
        if (
            action == ICamEscrowView.AgreementAction.ApproveAgreement
                || action == ICamEscrowView.AgreementAction.FinalizeReviewTimeout
                || action == ICamEscrowView.AgreementAction.ResolveForContractor
        ) {
            return agreement.contractor;
        }
        return agreement.arbitrationTimeoutBeneficiary == ICamEscrowView.ArbitrationTimeoutBeneficiary.Client
            ? agreement.client
            : agreement.contractor;
    }

    function _actionCallData(ICamEscrowView.AgreementAction action, bytes32 agreementId, uint256 seed)
        private
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
                CamEscrow.submitAgreement.selector, agreementId, _document("terminal-submission", agreementId, seed)
            );
        }
        if (action == ICamEscrowView.AgreementAction.ApproveAgreement) {
            return abi.encodeWithSelector(CamEscrow.approveAgreement.selector, agreementId);
        }
        if (action == ICamEscrowView.AgreementAction.DisputeAgreement) {
            return abi.encodeWithSelector(
                CamEscrow.disputeAgreement.selector, agreementId, _document("terminal-dispute", agreementId, seed)
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

    function _document(string memory kind, bytes32 agreementId, uint256 seed)
        private
        returns (ICamEscrowView.DocumentRef memory)
    {
        return ICamEscrowView.DocumentRef({
            uri: string.concat("ipfs://", kind, "/", vm.toString(seed)),
            sha256Digest: sha256(abi.encodePacked(kind, agreementId, seed))
        });
    }

    function _duration(uint64 seed) private pure returns (uint64) {
        return uint64((uint256(seed) % MAX_TEST_DURATION) + 1);
    }

    function _actor(uint256 seed) private view returns (address) {
        return _actors[seed % _actors.length];
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

    function _isTerminal(ICamEscrowView.AgreementState state) private pure returns (bool) {
        return uint256(state) > uint256(ICamEscrowView.AgreementState.Disputed);
    }
}
