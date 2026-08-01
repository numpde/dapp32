pragma solidity 0.8.35;

import {CamEscrow} from "../../src/CamEscrow.sol";
import {CamEscrowUI} from "../../src/CamEscrowUI.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowTestBase} from "../support/CamEscrowTestBase.sol";

contract FalseEscrowInterface {
    function supportsInterface(bytes4) external pure returns (bool) {
        return false;
    }
}

contract RevertingEscrowInterface {
    function supportsInterface(bytes4) external pure returns (bool) {
        revert("unsupported");
    }
}

/// @notice Deterministic projection tests for the escrow CAM read surface.
contract CamEscrowUITest is CamEscrowTestBase {
    CamEscrowUI private ui;

    function setUp() public override {
        super.setUp();
        ui = new CamEscrowUI(address(escrow));
    }

    /// @notice Construction accepts only a deployed ICamEscrowView implementation.
    function testConstructorVerifiesBackingInterface() external {
        vm.expectRevert(CamEscrowUI.ZeroAddress.selector);
        new CamEscrowUI(address(0));

        address noCode = address(0x1234);
        vm.expectRevert(
            abi.encodeWithSelector(CamEscrowUI.EscrowHasNoCode.selector, noCode)
        );
        new CamEscrowUI(noCode);

        FalseEscrowInterface falseInterface = new FalseEscrowInterface();
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrowUI.EscrowUnsupported.selector,
                address(falseInterface)
            )
        );
        new CamEscrowUI(address(falseInterface));

        RevertingEscrowInterface revertingInterface = new RevertingEscrowInterface();
        vm.expectRevert(
            abi.encodeWithSelector(
                CamEscrowUI.EscrowUnsupported.selector,
                address(revertingInterface)
            )
        );
        new CamEscrowUI(address(revertingInterface));

        assertEq(address(ui.escrow()), address(escrow));
        assertLt(address(ui).code.length, 24_576);
    }

    /// @notice The creation projection exposes fixed policy and no anonymous wallet action.
    function testCreateAgreementViewOwnsPolicyAndWalletAction() external view {
        CamEscrowUI.CreateAgreementView memory authenticated =
            ui.viewCreateAgreement(address(this));
        _assertString(authenticated.viewId, "escrow.create");
        assertEq(authenticated.client, address(this));
        assertEq(authenticated.maxAgreementRefBytes, escrow.MAX_AGREEMENT_REF_BYTES());
        assertEq(authenticated.maxDocumentUriBytes, escrow.MAX_DOCUMENT_URI_BYTES());
        assertEq(authenticated.maxPhaseDuration, escrow.MAX_PHASE_DURATION());
        assertEq(authenticated.arbitrationTimeoutBeneficiaryIds.length, 2);
        _assertString(authenticated.arbitrationTimeoutBeneficiaryIds[0], "client");
        _assertString(authenticated.arbitrationTimeoutBeneficiaryIds[1], "contractor");
        _assertStrings(authenticated.actions, _strings1("createAgreement"));

        CamEscrowUI.CreateAgreementView memory anonymousCreateView =
            ui.viewCreateAgreement(address(0));
        assertEq(anonymousCreateView.actions.length, 0);
        assertEq(anonymousCreateView.arbitrationTimeoutBeneficiaryIds.length, 2);
    }

    /// @notice Missing agreement projection is a stable uninstantiated machine observation.
    function testAbsentAgreementProjection() external view {
        bytes32 missingId = keccak256("missing-projection");
        CamEscrowUI.AgreementAppView memory view_ =
            ui.viewAgreement(missingId, contractor);

        _assertString(view_.viewId, "escrow.agreement.absent");
        _assertString(view_.machine.machineId, "escrow.agreement.v1");
        assertEq(view_.machine.instanceId, missingId);
        assertFalse(view_.machine.instantiated);
        _assertString(view_.machine.stateId, "");
        assertEq(view_.machine.transitionIds.length, 0);
        assertEq(view_.actor, contractor);
        _assertString(view_.actorRoleId, "none");
        assertEq(view_.agreement.agreementId, missingId);
        assertEq(
            uint256(view_.agreement.state),
            uint256(ICamEscrowView.AgreementState.None)
        );
        _assertString(view_.arbitrationTimeoutBeneficiaryId, "");
        assertFalse(view_.arbitratorAcknowledgementRequired);
        _assertString(view_.arbitratorAcknowledgementDisclosure, "");
    }

    /// @notice ID and reference observations project the same stored agreement facts.
    function testReferenceAndIdProjectionAreEquivalent() external {
        bytes32 agreementId = _create("projection-parity");
        CamEscrowUI.AgreementAppView memory byId =
            ui.viewAgreement(agreementId, contractor);
        CamEscrowUI.AgreementAppView memory byReference =
            ui.viewAgreementByReference(address(this), "projection-parity", contractor);

        assertEq(byReference.machine.instanceId, byId.machine.instanceId);
        _assertString(byReference.machine.stateId, byId.machine.stateId);
        _assertStrings(byReference.machine.transitionIds, byId.machine.transitionIds);
        assertEq(byReference.agreement.client, byId.agreement.client);
        assertEq(byReference.agreement.contractor, byId.agreement.contractor);
        assertEq(byReference.agreement.arbitrator, byId.agreement.arbitrator);
        assertEq(byReference.agreement.amount, byId.agreement.amount);
        _assertString(byReference.agreement.agreementRef, byId.agreement.agreementRef);
        _assertString(byReference.agreement.terms.uri, byId.agreement.terms.uri);
        assertEq(
            byReference.agreement.terms.sha256Digest,
            byId.agreement.terms.sha256Digest
        );
    }

    /// @notice Funded contractor view discloses the exact no-acknowledgement risk and fallback party.
    function testAcceptanceRiskDisclosureIsExplicitAndStructured() external {
        bytes32 clientFallback = _create(
            "client-fallback",
            ICamEscrowView.ArbitrationTimeoutBeneficiary.Client
        );
        CamEscrowUI.AgreementAppView memory clientView =
            ui.viewAgreement(clientFallback, contractor);

        _assertString(clientView.viewId, "escrow.agreement.active");
        _assertString(clientView.machine.machineId, "escrow.agreement.v1");
        assertTrue(clientView.machine.instantiated);
        _assertString(clientView.machine.stateId, "funded");
        _assertStrings(clientView.machine.transitionIds, _strings1("acceptAgreement"));
        _assertString(clientView.actorRoleId, "contractor");
        _assertString(clientView.arbitrationTimeoutBeneficiaryId, "client");
        assertFalse(clientView.arbitratorAcknowledgementRequired);
        _assertString(
            clientView.arbitratorAcknowledgementDisclosure,
            "not required and not recorded on-chain"
        );

        bytes32 contractorFallback = _create(
            "contractor-fallback",
            ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
        );
        CamEscrowUI.AgreementAppView memory contractorView =
            ui.viewAgreement(contractorFallback, contractor);
        _assertString(contractorView.arbitrationTimeoutBeneficiaryId, "contractor");
    }

    /// @notice Funded transition IDs follow the core edge set at all deadline boundaries.
    function testFundedStateActorTimeProjection() external {
        bytes32 agreementId = _create("funded-matrix");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertTransitions(agreementId, address(this), _strings1("cancelAgreement"));
        _assertTransitions(agreementId, contractor, _strings1("acceptAgreement"));
        _assertNoTransitions(agreementId, arbitrator);
        _assertNoTransitions(agreementId, unrelated);
        _assertNoTransitions(agreementId, address(0));

        _assertTimeoutMatrix(agreementId, deadline, "finalizeAcceptanceTimeout");
    }

    /// @notice Accepted transition IDs follow the core edge set at all deadline boundaries.
    function testAcceptedStateActorTimeProjection() external {
        bytes32 agreementId = _create("accepted-matrix");
        _accept(agreementId);
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertNoTransitions(agreementId, address(this));
        _assertTransitions(agreementId, contractor, _strings1("submitAgreement"));
        _assertNoTransitions(agreementId, arbitrator);
        _assertNoTransitions(agreementId, unrelated);
        _assertNoTransitions(agreementId, address(0));
        _assertStateId(agreementId, "accepted");

        _assertTimeoutMatrix(agreementId, deadline, "finalizeWorkTimeout");
    }

    /// @notice Submitted transition IDs follow the core edge set at all deadline boundaries.
    function testSubmittedStateActorTimeProjection() external {
        bytes32 agreementId = _create("submitted-matrix");
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "projection-submission");
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertTransitions(
            agreementId,
            address(this),
            _strings2("approveAgreement", "disputeAgreement")
        );
        _assertNoTransitions(agreementId, contractor);
        _assertNoTransitions(agreementId, arbitrator);
        _assertNoTransitions(agreementId, unrelated);
        _assertNoTransitions(agreementId, address(0));
        _assertStateId(agreementId, "submitted");

        _assertTimeoutMatrix(agreementId, deadline, "finalizeReviewTimeout");
    }

    /// @notice Disputed transition IDs follow the core edge set at all deadline boundaries.
    function testDisputedStateActorTimeProjection() external {
        bytes32 agreementId = _create("disputed-matrix");
        _acceptSubmitAndDispute(agreementId);
        uint256 deadline = escrow.agreementById(agreementId).deadline;

        vm.warp(deadline - 1);
        _assertNoTransitions(agreementId, address(this));
        _assertNoTransitions(agreementId, contractor);
        _assertTransitions(
            agreementId,
            arbitrator,
            _strings2("resolveForClient", "resolveForContractor")
        );
        _assertNoTransitions(agreementId, unrelated);
        _assertNoTransitions(agreementId, address(0));
        _assertStateId(agreementId, "disputed");

        _assertTimeoutMatrix(agreementId, deadline, "finalizeArbitrationTimeout");
    }

    /// @notice Every terminal contract outcome maps to one stable semantic state ID.
    function testEveryTerminalOutcomeHasStableStateId() external {
        bytes32 cancelled = _create("state-cancelled");
        escrow.cancelAgreement(cancelled);
        _assertTerminalStateId(cancelled, "cancelled.client");

        bytes32 approved = _create("state-approved");
        _accept(approved);
        _submit(approved, "ipfs://approved", "approved");
        escrow.approveAgreement(approved);
        _assertTerminalStateId(approved, "released.clientApproval");

        bytes32 acceptanceTimeout = _create("state-acceptance-timeout");
        _warpToDeadline(acceptanceTimeout);
        escrow.finalizeAcceptanceTimeout(acceptanceTimeout);
        _assertTerminalStateId(acceptanceTimeout, "refunded.acceptanceTimeout");

        bytes32 workTimeout = _create("state-work-timeout");
        _accept(workTimeout);
        _warpToDeadline(workTimeout);
        escrow.finalizeWorkTimeout(workTimeout);
        _assertTerminalStateId(workTimeout, "refunded.workTimeout");

        bytes32 reviewTimeout = _create("state-review-timeout");
        _accept(reviewTimeout);
        _submit(reviewTimeout, "ipfs://review", "review");
        _warpToDeadline(reviewTimeout);
        escrow.finalizeReviewTimeout(reviewTimeout);
        _assertTerminalStateId(reviewTimeout, "released.reviewTimeout");

        bytes32 arbitratorClient = _create("state-arbitrator-client");
        _acceptSubmitAndDispute(arbitratorClient);
        vm.prank(arbitrator);
        escrow.resolveForClient(arbitratorClient);
        _assertTerminalStateId(arbitratorClient, "refunded.arbitratorToClient");

        bytes32 arbitratorContractor = _create("state-arbitrator-contractor");
        _acceptSubmitAndDispute(arbitratorContractor);
        vm.prank(arbitrator);
        escrow.resolveForContractor(arbitratorContractor);
        _assertTerminalStateId(
            arbitratorContractor,
            "released.arbitratorToContractor"
        );

        bytes32 timeoutClient = _create(
            "state-timeout-client",
            ICamEscrowView.ArbitrationTimeoutBeneficiary.Client
        );
        _acceptSubmitAndDispute(timeoutClient);
        _warpToDeadline(timeoutClient);
        escrow.finalizeArbitrationTimeout(timeoutClient);
        _assertTerminalStateId(timeoutClient, "refunded.arbitrationTimeout");

        bytes32 timeoutContractor = _create(
            "state-timeout-contractor",
            ICamEscrowView.ArbitrationTimeoutBeneficiary.Contractor
        );
        _acceptSubmitAndDispute(timeoutContractor);
        _warpToDeadline(timeoutContractor);
        escrow.finalizeArbitrationTimeout(timeoutContractor);
        _assertTerminalStateId(timeoutContractor, "released.arbitrationTimeout");
    }

    /// @notice Credit projection follows aggregate core accounting and withdrawal completion.
    function testAccountCreditProjection() external {
        CamEscrowUI.AccountCreditView memory anonymousCreditView =
            ui.viewAccountCredit(address(0));
        _assertString(anonymousCreditView.viewId, "escrow.credit.empty");
        assertEq(anonymousCreditView.amount, 0);
        assertEq(anonymousCreditView.actions.length, 0);

        bytes32 first = _create("credit-projection-1");
        bytes32 second = _create("credit-projection-2");
        escrow.cancelAgreement(first);
        escrow.cancelAgreement(second);

        CamEscrowUI.AccountCreditView memory available =
            ui.viewAccountCredit(address(this));
        _assertString(available.viewId, "escrow.credit.available");
        assertEq(available.account, address(this));
        assertEq(available.amount, 2 * AMOUNT);
        _assertStrings(available.actions, _strings1("withdrawTo"));

        address payable recipient = payable(address(0xFEE));
        escrow.withdrawTo(recipient);

        CamEscrowUI.AccountCreditView memory empty =
            ui.viewAccountCredit(address(this));
        _assertString(empty.viewId, "escrow.credit.empty");
        assertEq(empty.amount, 0);
        assertEq(empty.actions.length, 0);
    }

    /// @notice The projection cannot receive value or expose undeclared selectors.
    function testProjectionRejectsNativeValueAndUnknownFunctions() external {
        (bool ok, bytes memory result) = payable(address(ui)).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrowUI.DoesNotAcceptPayments.selector))
        );

        bytes4 selector = bytes4(0x12345678);
        (ok, result) = address(ui).call(abi.encodeWithSelector(selector));
        assertFalse(ok);
        assertEq(
            keccak256(result),
            keccak256(abi.encodeWithSelector(CamEscrowUI.UnknownFunction.selector, selector))
        );
    }

    function _assertTimeoutMatrix(
        bytes32 agreementId,
        uint256 deadline,
        string memory timeoutTransition
    ) private {
        vm.warp(deadline);
        _assertTimeoutActors(agreementId, timeoutTransition);

        vm.warp(deadline + 1);
        _assertTimeoutActors(agreementId, timeoutTransition);
    }

    function _assertTimeoutActors(bytes32 agreementId, string memory transition)
        private
        view
    {
        string[] memory expected = _strings1(transition);
        _assertTransitions(agreementId, address(this), expected);
        _assertTransitions(agreementId, contractor, expected);
        _assertTransitions(agreementId, arbitrator, expected);
        _assertTransitions(agreementId, unrelated, expected);
        _assertNoTransitions(agreementId, address(0));
    }

    function _assertTerminalStateId(bytes32 agreementId, string memory expected)
        private
        view
    {
        CamEscrowUI.AgreementAppView memory view_ =
            ui.viewAgreement(agreementId, unrelated);
        _assertString(view_.viewId, "escrow.agreement.terminal");
        _assertString(view_.machine.stateId, expected);
        assertEq(view_.machine.transitionIds.length, 0);
    }

    function _assertStateId(bytes32 agreementId, string memory expected)
        private
        view
    {
        _assertString(ui.viewAgreement(agreementId, unrelated).machine.stateId, expected);
    }

    function _assertTransitions(
        bytes32 agreementId,
        address actor,
        string[] memory expected
    ) private view {
        CamEscrowUI.AgreementAppView memory view_ = ui.viewAgreement(agreementId, actor);
        _assertStrings(view_.machine.transitionIds, expected);
        assertEq(
            view_.machine.transitionIds.length,
            escrow.availableActions(agreementId, actor).length
        );
    }

    function _assertNoTransitions(bytes32 agreementId, address actor) private view {
        assertEq(ui.viewAgreement(agreementId, actor).machine.transitionIds.length, 0);
        assertEq(escrow.availableActions(agreementId, actor).length, 0);
    }

    function _assertStrings(string[] memory actual, string[] memory expected)
        private
        pure
    {
        assertEq(actual.length, expected.length);
        for (uint256 i = 0; i < expected.length; i++) {
            _assertString(actual[i], expected[i]);
        }
    }

    function _assertString(string memory actual, string memory expected) private pure {
        assertEq(keccak256(bytes(actual)), keccak256(bytes(expected)));
    }

    function _strings1(string memory value)
        private
        pure
        returns (string[] memory values)
    {
        values = new string[](1);
        values[0] = value;
    }

    function _strings2(string memory first, string memory second)
        private
        pure
        returns (string[] memory values)
    {
        values = new string[](2);
        values[0] = first;
        values[1] = second;
    }
}
