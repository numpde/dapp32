pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

/// @notice Read-only escrow surface consumed by CAM route projections.
/// @dev The interface owns stable agreement observation, enabled actions, and
/// liability reads. Agreement storage remains private in the implementation.
interface ICamEscrowView is IERC165 {
    enum ArbitrationTimeoutBeneficiary {
        None,
        Client,
        Contractor
    }

    enum AgreementState {
        None,
        Funded,
        Accepted,
        Submitted,
        Disputed,
        CancelledByClient,
        RefundedAfterAcceptanceTimeout,
        RefundedAfterWorkTimeout,
        RefundedByArbitrator,
        RefundedAfterArbitrationTimeout,
        ReleasedByClientApproval,
        ReleasedAfterReviewTimeout,
        ReleasedByArbitrator,
        ReleasedAfterArbitrationTimeout
    }

    enum AgreementAction {
        CancelAgreement,
        AcceptAgreement,
        SubmitAgreement,
        ApproveAgreement,
        DisputeAgreement,
        FinalizeAcceptanceTimeout,
        FinalizeWorkTimeout,
        FinalizeReviewTimeout,
        ResolveForClient,
        ResolveForContractor,
        FinalizeArbitrationTimeout
    }

    struct DocumentRef {
        string uri;
        bytes32 sha256Digest;
    }

    struct AgreementView {
        bytes32 agreementId;
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

    function MAX_AGREEMENT_REF_BYTES() external view returns (uint256);

    function MAX_DOCUMENT_URI_BYTES() external view returns (uint256);

    function MAX_PHASE_DURATION() external view returns (uint64);

    function agreementIdOf(address client, string calldata agreementRef) external pure returns (bytes32);

    function agreementById(bytes32 agreementId) external view returns (AgreementView memory view_);

    function agreementByReference(address client, string calldata agreementRef)
        external
        view
        returns (AgreementView memory view_);

    function availableActions(bytes32 agreementId, address actor)
        external
        view
        returns (AgreementAction[] memory actions);

    function withdrawable(address account) external view returns (uint256);

    function totalEscrowed() external view returns (uint256);

    function totalWithdrawable() external view returns (uint256);

    function totalLiabilities() external view returns (uint256);
}
