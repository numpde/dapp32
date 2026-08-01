pragma solidity 0.8.35;

import {ReentrancyGuard} from "@openzeppelin-contracts-5.6.1/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {ICamEscrowView} from "./ICamEscrowView.sol";

/// @title CamEscrow
/// @notice Single-milestone native-asset escrow with explicit timed settlement.
/// @dev
/// V1 has no owner, pause, upgrade, arbitrator acknowledgement, appeal, partial
/// award, fee, or automatic timeout execution. Creation escrows exact native
/// value immediately. Every terminal agreement state creates one full pull-
/// payment credit for exactly one beneficiary.
contract CamEscrow is ReentrancyGuard, ICamEscrowView {
    uint256 private constant _MAX_AGREEMENT_REF_BYTES = 128;
    uint256 private constant _MAX_DOCUMENT_URI_BYTES = 512;
    uint64 private constant _MAX_PHASE_DURATION = 365 days;

    struct CreateAgreementParams {
        string agreementRef;
        address contractor;
        address arbitrator;
        ArbitrationTimeoutBeneficiary arbitrationTimeoutBeneficiary;
        uint256 amount;
        uint64 acceptanceDuration;
        uint64 workDuration;
        uint64 reviewDuration;
        uint64 arbitrationDuration;
        DocumentRef terms;
    }

    struct Agreement {
        AgreementState state;
        address client;
        address contractor;
        address arbitrator;
        ArbitrationTimeoutBeneficiary arbitrationTimeoutBeneficiary;
        uint256 amount;
        uint64 acceptanceDuration;
        uint64 workDuration;
        uint64 reviewDuration;
        uint64 arbitrationDuration;
        uint256 deadline;
        string agreementRef;
        DocumentRef terms;
        DocumentRef submission;
        DocumentRef dispute;
    }

    mapping(bytes32 agreementId => Agreement agreement) private _agreements;
    mapping(address account => uint256 amount) private _withdrawable;

    uint256 private _totalEscrowed;
    uint256 private _totalWithdrawable;

    error InvalidReferenceLength(uint256 length);
    error InvalidPartyConfiguration(address client, address contractor, address arbitrator);
    error InvalidArbitrationTimeoutBeneficiary(ArbitrationTimeoutBeneficiary beneficiary);
    error InvalidAmount(uint256 amount);
    error NativeAmountMismatch(uint256 expected, uint256 received);
    error InvalidAcceptanceDuration(uint64 duration);
    error InvalidWorkDuration(uint64 duration);
    error InvalidReviewDuration(uint64 duration);
    error InvalidArbitrationDuration(uint64 duration);
    error InvalidDocumentURI(uint256 length);
    error InvalidDocumentDigest();
    error AgreementAlreadyExists(bytes32 agreementId);
    error AgreementNotFound(bytes32 agreementId);
    error ActionUnavailable(
        bytes32 agreementId,
        AgreementAction action,
        address actor,
        AgreementState state,
        uint256 deadline,
        uint256 currentTime
    );
    error InvalidWithdrawalRecipient(address recipient);
    error NoWithdrawalCredit(address account);
    error NativeTransferFailed(address recipient, uint256 amount);
    error DirectNativeTransferDisabled();
    error UnknownFunction(bytes4 selector);

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
        AgreementState fromState,
        AgreementState toState,
        uint256 deadline
    );

    event Withdrawal(address indexed account, address indexed recipient, uint256 amount);

    /// @notice Creates and immediately funds one agreement.
    /// @dev The timeout beneficiary error covers the in-range `None` sentinel.
    /// Out-of-range enum ordinals are rejected by Solidity's ABI boundary.
    function createAgreement(CreateAgreementParams calldata params) external payable returns (bytes32 agreementId) {
        _validateReference(params.agreementRef);
        _validateParties(msg.sender, params.contractor, params.arbitrator);
        _validateTimeoutBeneficiary(params.arbitrationTimeoutBeneficiary);

        if (params.amount == 0) revert InvalidAmount(params.amount);

        _validateDurations(params);
        _validateDocument(params.terms);

        agreementId = _agreementId(msg.sender, params.agreementRef);
        if (_agreements[agreementId].state != AgreementState.None) {
            revert AgreementAlreadyExists(agreementId);
        }
        if (msg.value != params.amount) {
            revert NativeAmountMismatch(params.amount, msg.value);
        }

        Agreement storage agreement = _agreements[agreementId];
        agreement.state = AgreementState.Funded;
        agreement.client = msg.sender;
        agreement.contractor = params.contractor;
        agreement.arbitrator = params.arbitrator;
        agreement.arbitrationTimeoutBeneficiary = params.arbitrationTimeoutBeneficiary;
        agreement.amount = params.amount;
        agreement.acceptanceDuration = params.acceptanceDuration;
        agreement.workDuration = params.workDuration;
        agreement.reviewDuration = params.reviewDuration;
        agreement.arbitrationDuration = params.arbitrationDuration;
        agreement.deadline = block.timestamp + uint256(params.acceptanceDuration);
        agreement.agreementRef = params.agreementRef;
        agreement.terms.uri = params.terms.uri;
        agreement.terms.sha256Digest = params.terms.sha256Digest;

        _totalEscrowed += params.amount;

        emit AgreementCreated(
            agreementId, msg.sender, params.contractor, params.arbitrator, params.amount, agreement.deadline
        );
    }

    function cancelAgreement(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.CancelAgreement, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.CancelledByClient, agreement.client, msg.sender);
    }

    function acceptAgreement(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.AcceptAgreement, msg.sender, now_);
        _advance(agreementId, agreement, AgreementState.Accepted, now_ + uint256(agreement.workDuration), msg.sender);
    }

    function submitAgreement(bytes32 agreementId, DocumentRef calldata submission) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.SubmitAgreement, msg.sender, now_);
        _validateDocument(submission);

        agreement.submission.uri = submission.uri;
        agreement.submission.sha256Digest = submission.sha256Digest;
        _advance(agreementId, agreement, AgreementState.Submitted, now_ + uint256(agreement.reviewDuration), msg.sender);
    }

    function approveAgreement(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.ApproveAgreement, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.ReleasedByClientApproval, agreement.contractor, msg.sender);
    }

    function disputeAgreement(bytes32 agreementId, DocumentRef calldata dispute) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.DisputeAgreement, msg.sender, now_);
        _validateDocument(dispute);

        agreement.dispute.uri = dispute.uri;
        agreement.dispute.sha256Digest = dispute.sha256Digest;
        _advance(
            agreementId, agreement, AgreementState.Disputed, now_ + uint256(agreement.arbitrationDuration), msg.sender
        );
    }

    function finalizeAcceptanceTimeout(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.FinalizeAcceptanceTimeout, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.RefundedAfterAcceptanceTimeout, agreement.client, msg.sender);
    }

    function finalizeWorkTimeout(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.FinalizeWorkTimeout, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.RefundedAfterWorkTimeout, agreement.client, msg.sender);
    }

    function finalizeReviewTimeout(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.FinalizeReviewTimeout, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.ReleasedAfterReviewTimeout, agreement.contractor, msg.sender);
    }

    function resolveForClient(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.ResolveForClient, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.RefundedByArbitrator, agreement.client, msg.sender);
    }

    function resolveForContractor(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.ResolveForContractor, msg.sender, now_);
        _settle(agreementId, agreement, AgreementState.ReleasedByArbitrator, agreement.contractor, msg.sender);
    }

    function finalizeArbitrationTimeout(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        uint256 now_ = block.timestamp;
        _requireActionAvailable(agreementId, agreement, AgreementAction.FinalizeArbitrationTimeout, msg.sender, now_);

        if (agreement.arbitrationTimeoutBeneficiary == ArbitrationTimeoutBeneficiary.Client) {
            _settle(
                agreementId, agreement, AgreementState.RefundedAfterArbitrationTimeout, agreement.client, msg.sender
            );
            return;
        }
        if (agreement.arbitrationTimeoutBeneficiary == ArbitrationTimeoutBeneficiary.Contractor) {
            _settle(
                agreementId, agreement, AgreementState.ReleasedAfterArbitrationTimeout, agreement.contractor, msg.sender
            );
            return;
        }

        revert InvalidArbitrationTimeoutBeneficiary(agreement.arbitrationTimeoutBeneficiary);
    }

    /// @notice Withdraws the caller's complete aggregated credit to `recipient`.
    function withdrawTo(address payable recipient) external nonReentrant {
        if (recipient == address(0) || recipient == address(this)) {
            revert InvalidWithdrawalRecipient(recipient);
        }

        address account = msg.sender;
        uint256 amount = _withdrawable[account];
        if (amount == 0) revert NoWithdrawalCredit(account);

        _withdrawable[account] = 0;
        _totalWithdrawable -= amount;

        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed(recipient, amount);

        emit Withdrawal(account, recipient, amount);
    }

    function agreementIdOf(address client, string calldata agreementRef) external pure override returns (bytes32) {
        return _agreementId(client, agreementRef);
    }

    function agreementById(bytes32 agreementId) external view override returns (AgreementView memory view_) {
        return _agreementView(agreementId);
    }

    function agreementByReference(address client, string calldata agreementRef)
        external
        view
        override
        returns (AgreementView memory view_)
    {
        return _agreementView(_agreementId(client, agreementRef));
    }

    function availableActions(bytes32 agreementId, address actor)
        external
        view
        override
        returns (AgreementAction[] memory actions)
    {
        Agreement storage agreement = _agreements[agreementId];
        uint256 now_ = block.timestamp;
        uint256 actionCount = uint256(AgreementAction.FinalizeArbitrationTimeout) + 1;
        uint256 availableCount;

        for (uint256 i = 0; i < actionCount; i++) {
            if (_isActionAvailable(agreement, AgreementAction(i), actor, now_)) {
                availableCount++;
            }
        }

        actions = new AgreementAction[](availableCount);
        uint256 index;
        for (uint256 i = 0; i < actionCount; i++) {
            AgreementAction action = AgreementAction(i);
            if (_isActionAvailable(agreement, action, actor, now_)) {
                actions[index++] = action;
            }
        }
    }

    function MAX_AGREEMENT_REF_BYTES() external pure override returns (uint256) {
        return _MAX_AGREEMENT_REF_BYTES;
    }

    function MAX_DOCUMENT_URI_BYTES() external pure override returns (uint256) {
        return _MAX_DOCUMENT_URI_BYTES;
    }

    function MAX_PHASE_DURATION() external pure override returns (uint64) {
        return _MAX_PHASE_DURATION;
    }

    function withdrawable(address account) external view override returns (uint256) {
        return _withdrawable[account];
    }

    function totalEscrowed() external view override returns (uint256) {
        return _totalEscrowed;
    }

    function totalWithdrawable() external view override returns (uint256) {
        return _totalWithdrawable;
    }

    function totalLiabilities() external view override returns (uint256) {
        return _totalEscrowed + _totalWithdrawable;
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(ICamEscrowView).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    function _isActionAvailable(Agreement storage agreement, AgreementAction action, address actor, uint256 now_)
        private
        view
        returns (bool)
    {
        if (actor == address(0)) return false;

        if (action == AgreementAction.CancelAgreement) {
            return agreement.state == AgreementState.Funded && actor == agreement.client && now_ < agreement.deadline;
        }
        if (action == AgreementAction.AcceptAgreement) {
            // This is the deliberate V1/V2 readiness seam. V1 requires no
            // arbitrator transaction, signature, or acknowledgement.
            return
                agreement.state == AgreementState.Funded && actor == agreement.contractor && now_ < agreement.deadline;
        }
        if (action == AgreementAction.SubmitAgreement) {
            return
                agreement.state == AgreementState.Accepted && actor == agreement.contractor && now_ < agreement.deadline;
        }
        if (action == AgreementAction.ApproveAgreement) {
            return agreement.state == AgreementState.Submitted && actor == agreement.client && now_ < agreement.deadline;
        }
        if (action == AgreementAction.DisputeAgreement) {
            return agreement.state == AgreementState.Submitted && actor == agreement.client && now_ < agreement.deadline;
        }
        if (action == AgreementAction.FinalizeAcceptanceTimeout) {
            return agreement.state == AgreementState.Funded && now_ >= agreement.deadline;
        }
        if (action == AgreementAction.FinalizeWorkTimeout) {
            return agreement.state == AgreementState.Accepted && now_ >= agreement.deadline;
        }
        if (action == AgreementAction.FinalizeReviewTimeout) {
            return agreement.state == AgreementState.Submitted && now_ >= agreement.deadline;
        }
        if (action == AgreementAction.ResolveForClient) {
            return
                agreement.state == AgreementState.Disputed && actor == agreement.arbitrator && now_ < agreement.deadline;
        }
        if (action == AgreementAction.ResolveForContractor) {
            return
                agreement.state == AgreementState.Disputed && actor == agreement.arbitrator && now_ < agreement.deadline;
        }
        if (action == AgreementAction.FinalizeArbitrationTimeout) {
            return agreement.state == AgreementState.Disputed && now_ >= agreement.deadline;
        }

        return false;
    }

    function _requireActionAvailable(
        bytes32 agreementId,
        Agreement storage agreement,
        AgreementAction action,
        address actor,
        uint256 now_
    ) private view {
        if (!_isActionAvailable(agreement, action, actor, now_)) {
            revert ActionUnavailable(agreementId, action, actor, agreement.state, agreement.deadline, now_);
        }
    }

    function _advance(
        bytes32 agreementId,
        Agreement storage agreement,
        AgreementState toState,
        uint256 deadline,
        address actor
    ) private {
        AgreementState fromState = agreement.state;
        agreement.state = toState;
        agreement.deadline = deadline;
        emit AgreementStateChanged(agreementId, actor, fromState, toState, deadline);
    }

    function _settle(
        bytes32 agreementId,
        Agreement storage agreement,
        AgreementState toState,
        address beneficiary,
        address actor
    ) private {
        uint256 amount = agreement.amount;
        _totalEscrowed -= amount;
        _withdrawable[beneficiary] += amount;
        _totalWithdrawable += amount;
        _advance(agreementId, agreement, toState, 0, actor);
    }

    function _agreementView(bytes32 agreementId) private view returns (AgreementView memory view_) {
        Agreement storage agreement = _agreements[agreementId];

        view_.agreementId = agreementId;
        view_.state = agreement.state;
        if (agreement.state == AgreementState.None) return view_;

        view_.client = agreement.client;
        view_.contractor = agreement.contractor;
        view_.arbitrator = agreement.arbitrator;
        view_.arbitrationTimeoutBeneficiary = agreement.arbitrationTimeoutBeneficiary;
        view_.amount = agreement.amount;
        view_.acceptanceDuration = agreement.acceptanceDuration;
        view_.workDuration = agreement.workDuration;
        view_.reviewDuration = agreement.reviewDuration;
        view_.arbitrationDuration = agreement.arbitrationDuration;
        view_.deadline = agreement.deadline;
        view_.agreementRef = agreement.agreementRef;
        view_.terms = DocumentRef({uri: agreement.terms.uri, sha256Digest: agreement.terms.sha256Digest});
        view_.submission = DocumentRef({uri: agreement.submission.uri, sha256Digest: agreement.submission.sha256Digest});
        view_.dispute = DocumentRef({uri: agreement.dispute.uri, sha256Digest: agreement.dispute.sha256Digest});
    }

    function _requireAgreement(bytes32 agreementId) private view returns (Agreement storage agreement) {
        agreement = _agreements[agreementId];
        if (agreement.state == AgreementState.None) revert AgreementNotFound(agreementId);
    }

    function _validateReference(string calldata agreementRef) private pure {
        uint256 length = bytes(agreementRef).length;
        if (length == 0 || length > _MAX_AGREEMENT_REF_BYTES) {
            revert InvalidReferenceLength(length);
        }
    }

    function _validateParties(address client, address contractor, address arbitrator) private view {
        if (
            contractor == address(0) || arbitrator == address(0) || client == contractor || client == arbitrator
                || contractor == arbitrator || contractor == address(this) || arbitrator == address(this)
        ) {
            revert InvalidPartyConfiguration(client, contractor, arbitrator);
        }
    }

    function _validateTimeoutBeneficiary(ArbitrationTimeoutBeneficiary beneficiary) private pure {
        if (beneficiary == ArbitrationTimeoutBeneficiary.None) {
            revert InvalidArbitrationTimeoutBeneficiary(beneficiary);
        }
    }

    function _validateDurations(CreateAgreementParams calldata params) private pure {
        if (params.acceptanceDuration == 0 || params.acceptanceDuration > _MAX_PHASE_DURATION) {
            revert InvalidAcceptanceDuration(params.acceptanceDuration);
        }
        if (params.workDuration == 0 || params.workDuration > _MAX_PHASE_DURATION) {
            revert InvalidWorkDuration(params.workDuration);
        }
        if (params.reviewDuration == 0 || params.reviewDuration > _MAX_PHASE_DURATION) {
            revert InvalidReviewDuration(params.reviewDuration);
        }
        if (params.arbitrationDuration == 0 || params.arbitrationDuration > _MAX_PHASE_DURATION) {
            revert InvalidArbitrationDuration(params.arbitrationDuration);
        }
    }

    function _validateDocument(DocumentRef calldata document) private pure {
        uint256 length = bytes(document.uri).length;
        if (length == 0 || length > _MAX_DOCUMENT_URI_BYTES) {
            revert InvalidDocumentURI(length);
        }
        if (document.sha256Digest == bytes32(0)) revert InvalidDocumentDigest();
    }

    function _agreementId(address client, string calldata agreementRef) private pure returns (bytes32) {
        return keccak256(abi.encode(client, agreementRef));
    }

    receive() external payable {
        revert DirectNativeTransferDisabled();
    }

    fallback() external payable {
        revert UnknownFunction(msg.sig);
    }
}
