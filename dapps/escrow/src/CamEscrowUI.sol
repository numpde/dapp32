pragma solidity 0.8.35;

import {ICamEscrowView} from "./ICamEscrowView.sol";

/// @title CamEscrowUI
/// @notice Read-only semantic projection for the CAM escrow application.
/// @dev
/// The backing escrow remains authoritative for agreement state, actor/time
/// authorization, enabled actions, deadlines, documents, and accounting. This
/// contract maps those facts to stable presentation identifiers and never calls
/// an escrow write function.
contract CamEscrowUI {
    ICamEscrowView public immutable escrow;

    string private constant MACHINE_AGREEMENT = "escrow.agreement.v1";

    string private constant VIEW_CREATE = "escrow.create";
    string private constant VIEW_AGREEMENT_ABSENT = "escrow.agreement.absent";
    string private constant VIEW_AGREEMENT_ACTIVE = "escrow.agreement.active";
    string private constant VIEW_AGREEMENT_TERMINAL = "escrow.agreement.terminal";
    string private constant VIEW_CREDIT_EMPTY = "escrow.credit.empty";
    string private constant VIEW_CREDIT_AVAILABLE = "escrow.credit.available";

    string private constant STATE_FUNDED = "funded";
    string private constant STATE_ACCEPTED = "accepted";
    string private constant STATE_SUBMITTED = "submitted";
    string private constant STATE_DISPUTED = "disputed";
    string private constant STATE_CANCELLED_CLIENT = "cancelled.client";
    string private constant STATE_REFUNDED_ACCEPTANCE_TIMEOUT = "refunded.acceptanceTimeout";
    string private constant STATE_REFUNDED_WORK_TIMEOUT = "refunded.workTimeout";
    string private constant STATE_REFUNDED_ARBITRATOR_CLIENT = "refunded.arbitratorToClient";
    string private constant STATE_REFUNDED_ARBITRATION_TIMEOUT = "refunded.arbitrationTimeout";
    string private constant STATE_RELEASED_CLIENT_APPROVAL = "released.clientApproval";
    string private constant STATE_RELEASED_REVIEW_TIMEOUT = "released.reviewTimeout";
    string private constant STATE_RELEASED_ARBITRATOR_CONTRACTOR = "released.arbitratorToContractor";
    string private constant STATE_RELEASED_ARBITRATION_TIMEOUT = "released.arbitrationTimeout";

    string private constant TRANSITION_CANCEL = "cancelAgreement";
    string private constant TRANSITION_ACCEPT = "acceptAgreement";
    string private constant TRANSITION_SUBMIT = "submitAgreement";
    string private constant TRANSITION_APPROVE = "approveAgreement";
    string private constant TRANSITION_DISPUTE = "disputeAgreement";
    string private constant TRANSITION_ACCEPTANCE_TIMEOUT = "finalizeAcceptanceTimeout";
    string private constant TRANSITION_WORK_TIMEOUT = "finalizeWorkTimeout";
    string private constant TRANSITION_REVIEW_TIMEOUT = "finalizeReviewTimeout";
    string private constant TRANSITION_RESOLVE_CLIENT = "resolveForClient";
    string private constant TRANSITION_RESOLVE_CONTRACTOR = "resolveForContractor";
    string private constant TRANSITION_ARBITRATION_TIMEOUT = "finalizeArbitrationTimeout";

    string private constant ACTION_CREATE = "createAgreement";
    string private constant ACTION_WITHDRAW = "withdrawTo";

    string private constant ROLE_NONE = "none";
    string private constant ROLE_CLIENT = "client";
    string private constant ROLE_CONTRACTOR = "contractor";
    string private constant ROLE_ARBITRATOR = "arbitrator";

    string private constant BENEFICIARY_CLIENT = "client";
    string private constant BENEFICIARY_CONTRACTOR = "contractor";

    string private constant ACKNOWLEDGEMENT_DISCLOSURE = "not required and not recorded on-chain";

    struct MachineView {
        string machineId;
        bytes32 instanceId;
        bool instantiated;
        string stateId;
        string[] transitionIds;
    }

    struct CreateAgreementView {
        string viewId;
        address client;
        uint256 maxAgreementRefBytes;
        uint256 maxDocumentUriBytes;
        uint64 maxPhaseDuration;
        string[] arbitrationTimeoutBeneficiaryIds;
        string[] actions;
    }

    struct AgreementAppView {
        string viewId;
        MachineView machine;
        address actor;
        string actorRoleId;
        ICamEscrowView.AgreementView agreement;
        string arbitrationTimeoutBeneficiaryId;
        bool arbitratorAcknowledgementRequired;
        string arbitratorAcknowledgementDisclosure;
    }

    struct AccountCreditView {
        string viewId;
        address account;
        uint256 amount;
        string[] actions;
    }

    error ZeroAddress();
    error EscrowHasNoCode(address escrowAddress);
    error EscrowUnsupported(address escrowAddress);
    error UnsupportedAgreementState(ICamEscrowView.AgreementState state);
    error UnsupportedAgreementAction(ICamEscrowView.AgreementAction action);
    error UnsupportedArbitrationTimeoutBeneficiary(ICamEscrowView.ArbitrationTimeoutBeneficiary beneficiary);
    error DoesNotAcceptPayments();
    error UnknownFunction(bytes4 selector);

    constructor(address escrowAddress) {
        if (escrowAddress == address(0)) revert ZeroAddress();
        if (escrowAddress.code.length == 0) revert EscrowHasNoCode(escrowAddress);

        try ICamEscrowView(escrowAddress).supportsInterface(type(ICamEscrowView).interfaceId) returns (bool supported) {
            if (!supported) revert EscrowUnsupported(escrowAddress);
        } catch {
            revert EscrowUnsupported(escrowAddress);
        }

        escrow = ICamEscrowView(escrowAddress);
    }

    /// @notice Returns immutable V1 creation policy and the creation action.
    /// @dev An anonymous viewer receives no wallet action, but all policy values.
    function viewCreateAgreement(address client) external view returns (CreateAgreementView memory view_) {
        view_.viewId = VIEW_CREATE;
        view_.client = client;
        view_.maxAgreementRefBytes = escrow.MAX_AGREEMENT_REF_BYTES();
        view_.maxDocumentUriBytes = escrow.MAX_DOCUMENT_URI_BYTES();
        view_.maxPhaseDuration = escrow.MAX_PHASE_DURATION();
        view_.arbitrationTimeoutBeneficiaryIds = new string[](2);
        view_.arbitrationTimeoutBeneficiaryIds[0] = BENEFICIARY_CLIENT;
        view_.arbitrationTimeoutBeneficiaryIds[1] = BENEFICIARY_CONTRACTOR;

        if (client != address(0)) {
            view_.actions = new string[](1);
            view_.actions[0] = ACTION_CREATE;
        }
    }

    /// @notice Projects one agreement by its contract-scoped identifier.
    function viewAgreement(bytes32 agreementId, address actor) external view returns (AgreementAppView memory view_) {
        return _agreementView(escrow.agreementById(agreementId), actor);
    }

    /// @notice Projects one agreement by its client/reference lookup key.
    function viewAgreementByReference(address client, string calldata agreementRef, address actor)
        external
        view
        returns (AgreementAppView memory view_)
    {
        return _agreementView(escrow.agreementByReference(client, agreementRef), actor);
    }

    /// @notice Projects one account's aggregate pull-payment credit.
    function viewAccountCredit(address account) external view returns (AccountCreditView memory view_) {
        view_.account = account;
        view_.amount = account == address(0) ? 0 : escrow.withdrawable(account);

        if (view_.amount == 0) {
            view_.viewId = VIEW_CREDIT_EMPTY;
            return view_;
        }

        view_.viewId = VIEW_CREDIT_AVAILABLE;
        view_.actions = new string[](1);
        view_.actions[0] = ACTION_WITHDRAW;
    }

    function _agreementView(ICamEscrowView.AgreementView memory agreement, address actor)
        private
        view
        returns (AgreementAppView memory view_)
    {
        view_.actor = actor;
        view_.agreement = agreement;
        view_.machine.machineId = MACHINE_AGREEMENT;
        view_.machine.instanceId = agreement.agreementId;

        if (agreement.state == ICamEscrowView.AgreementState.None) {
            view_.viewId = VIEW_AGREEMENT_ABSENT;
            view_.actorRoleId = ROLE_NONE;
            return view_;
        }

        view_.machine.instantiated = true;
        view_.machine.stateId = _stateId(agreement.state);
        view_.machine.transitionIds = _transitionIds(escrow.availableActions(agreement.agreementId, actor));
        view_.viewId = _agreementViewId(agreement.state);
        view_.actorRoleId = _actorRoleId(agreement, actor);
        view_.arbitrationTimeoutBeneficiaryId = _timeoutBeneficiaryId(agreement.arbitrationTimeoutBeneficiary);
        view_.arbitratorAcknowledgementRequired = false;
        view_.arbitratorAcknowledgementDisclosure = ACKNOWLEDGEMENT_DISCLOSURE;
    }

    function _transitionIds(ICamEscrowView.AgreementAction[] memory actions)
        private
        pure
        returns (string[] memory ids)
    {
        ids = new string[](actions.length);
        for (uint256 i = 0; i < actions.length; i++) {
            ids[i] = _transitionId(actions[i]);
        }
    }

    function _stateId(ICamEscrowView.AgreementState state) private pure returns (string memory) {
        if (state == ICamEscrowView.AgreementState.Funded) return STATE_FUNDED;
        if (state == ICamEscrowView.AgreementState.Accepted) return STATE_ACCEPTED;
        if (state == ICamEscrowView.AgreementState.Submitted) return STATE_SUBMITTED;
        if (state == ICamEscrowView.AgreementState.Disputed) return STATE_DISPUTED;
        if (state == ICamEscrowView.AgreementState.CancelledByClient) {
            return STATE_CANCELLED_CLIENT;
        }
        if (state == ICamEscrowView.AgreementState.RefundedAfterAcceptanceTimeout) {
            return STATE_REFUNDED_ACCEPTANCE_TIMEOUT;
        }
        if (state == ICamEscrowView.AgreementState.RefundedAfterWorkTimeout) {
            return STATE_REFUNDED_WORK_TIMEOUT;
        }
        if (state == ICamEscrowView.AgreementState.RefundedByArbitrator) {
            return STATE_REFUNDED_ARBITRATOR_CLIENT;
        }
        if (state == ICamEscrowView.AgreementState.RefundedAfterArbitrationTimeout) {
            return STATE_REFUNDED_ARBITRATION_TIMEOUT;
        }
        if (state == ICamEscrowView.AgreementState.ReleasedByClientApproval) {
            return STATE_RELEASED_CLIENT_APPROVAL;
        }
        if (state == ICamEscrowView.AgreementState.ReleasedAfterReviewTimeout) {
            return STATE_RELEASED_REVIEW_TIMEOUT;
        }
        if (state == ICamEscrowView.AgreementState.ReleasedByArbitrator) {
            return STATE_RELEASED_ARBITRATOR_CONTRACTOR;
        }
        if (state == ICamEscrowView.AgreementState.ReleasedAfterArbitrationTimeout) {
            return STATE_RELEASED_ARBITRATION_TIMEOUT;
        }

        revert UnsupportedAgreementState(state);
    }

    function _transitionId(ICamEscrowView.AgreementAction action) private pure returns (string memory) {
        if (action == ICamEscrowView.AgreementAction.CancelAgreement) {
            return TRANSITION_CANCEL;
        }
        if (action == ICamEscrowView.AgreementAction.AcceptAgreement) {
            return TRANSITION_ACCEPT;
        }
        if (action == ICamEscrowView.AgreementAction.SubmitAgreement) {
            return TRANSITION_SUBMIT;
        }
        if (action == ICamEscrowView.AgreementAction.ApproveAgreement) {
            return TRANSITION_APPROVE;
        }
        if (action == ICamEscrowView.AgreementAction.DisputeAgreement) {
            return TRANSITION_DISPUTE;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeAcceptanceTimeout) {
            return TRANSITION_ACCEPTANCE_TIMEOUT;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeWorkTimeout) {
            return TRANSITION_WORK_TIMEOUT;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeReviewTimeout) {
            return TRANSITION_REVIEW_TIMEOUT;
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForClient) {
            return TRANSITION_RESOLVE_CLIENT;
        }
        if (action == ICamEscrowView.AgreementAction.ResolveForContractor) {
            return TRANSITION_RESOLVE_CONTRACTOR;
        }
        if (action == ICamEscrowView.AgreementAction.FinalizeArbitrationTimeout) {
            return TRANSITION_ARBITRATION_TIMEOUT;
        }

        revert UnsupportedAgreementAction(action);
    }

    function _agreementViewId(ICamEscrowView.AgreementState state) private pure returns (string memory) {
        if (
            state == ICamEscrowView.AgreementState.Funded || state == ICamEscrowView.AgreementState.Accepted
                || state == ICamEscrowView.AgreementState.Submitted || state == ICamEscrowView.AgreementState.Disputed
        ) {
            return VIEW_AGREEMENT_ACTIVE;
        }

        if (uint256(state) > uint256(ICamEscrowView.AgreementState.Disputed)) {
            return VIEW_AGREEMENT_TERMINAL;
        }

        revert UnsupportedAgreementState(state);
    }

    function _actorRoleId(ICamEscrowView.AgreementView memory agreement, address actor)
        private
        pure
        returns (string memory)
    {
        if (actor == address(0)) return ROLE_NONE;
        if (actor == agreement.client) return ROLE_CLIENT;
        if (actor == agreement.contractor) return ROLE_CONTRACTOR;
        if (actor == agreement.arbitrator) return ROLE_ARBITRATOR;
        return ROLE_NONE;
    }

    function _timeoutBeneficiaryId(ICamEscrowView.ArbitrationTimeoutBeneficiary beneficiary)
        private
        pure
        returns (string memory)
    {
        if (beneficiary == ICamEscrowView.ArbitrationTimeoutBeneficiary.Client) {
            return BENEFICIARY_CLIENT;
        }
        if (beneficiary == ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor) {
            return BENEFICIARY_CONTRACTOR;
        }

        revert UnsupportedArbitrationTimeoutBeneficiary(beneficiary);
    }

    receive() external payable {
        revert DoesNotAcceptPayments();
    }

    fallback() external payable {
        revert UnknownFunction(msg.sig);
    }
}
