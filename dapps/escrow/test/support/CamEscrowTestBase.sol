pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";

/// @dev Shared deterministic fixture for escrow unit and scenario tests.
/// Document references are always built before installing a prank because
/// Solidity's `sha256` builtin calls the SHA-256 precompile and would otherwise
/// consume a one-shot `vm.prank` before the intended escrow call.
abstract contract CamEscrowTestBase is Test {
    uint256 internal constant AMOUNT = 10 ether;
    uint64 internal constant ACCEPTANCE_DURATION = 2 days;
    uint64 internal constant WORK_DURATION = 3 days;
    uint64 internal constant REVIEW_DURATION = 4 days;
    uint64 internal constant ARBITRATION_DURATION = 5 days;

    address internal contractor = address(0xC0FFEE);
    address internal arbitrator = address(0xA11CE);
    address internal unrelated = address(0xB0B);
    address internal finalizer = address(0xF1A1);

    CamEscrow internal escrow;

    function setUp() public virtual {
        escrow = new CamEscrow();
        vm.deal(address(this), 1_000 ether);
        vm.deal(contractor, 100 ether);
        vm.deal(arbitrator, 100 ether);
        vm.deal(unrelated, 100 ether);
        vm.deal(finalizer, 100 ether);
    }

    function _create(string memory agreementRef) internal returns (bytes32) {
        return _create(agreementRef, ICamEscrowView.ArbitrationTimeoutBeneficiary.Client);
    }

    function _create(
        string memory agreementRef,
        ICamEscrowView.ArbitrationTimeoutBeneficiary timeoutBeneficiary
    ) internal returns (bytes32) {
        CamEscrow.CreateAgreementParams memory params = _defaultParams(agreementRef);
        params.arbitrationTimeoutBeneficiary = timeoutBeneficiary;
        return escrow.createAgreement{value: AMOUNT}(params);
    }

    function _defaultParams(string memory agreementRef)
        internal
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
        internal
        pure
        returns (ICamEscrowView.DocumentRef memory)
    {
        return ICamEscrowView.DocumentRef({uri: uri, sha256Digest: sha256(bytes(seed))});
    }

    function _accept(bytes32 agreementId) internal {
        vm.prank(contractor);
        escrow.acceptAgreement(agreementId);
    }

    function _submit(bytes32 agreementId, string memory uri, string memory seed) internal {
        ICamEscrowView.DocumentRef memory submission = _document(uri, seed);
        vm.prank(contractor);
        escrow.submitAgreement(agreementId, submission);
    }

    function _dispute(bytes32 agreementId, string memory uri, string memory seed) internal {
        ICamEscrowView.DocumentRef memory dispute = _document(uri, seed);
        escrow.disputeAgreement(agreementId, dispute);
    }

    function _acceptSubmitAndDispute(bytes32 agreementId) internal {
        _accept(agreementId);
        _submit(agreementId, "ipfs://submission", "submission");
        _dispute(agreementId, "ipfs://dispute", "dispute");
    }

    function _warpToDeadline(bytes32 agreementId) internal {
        vm.warp(escrow.agreementById(agreementId).deadline);
    }

    function _assertState(bytes32 agreementId, ICamEscrowView.AgreementState expectedState)
        internal
        view
    {
        assertEq(uint256(escrow.agreementById(agreementId).state), uint256(expectedState));
    }

    function _assertActions(
        bytes32 agreementId,
        address actor,
        ICamEscrowView.AgreementAction[] memory expected
    ) internal view {
        ICamEscrowView.AgreementAction[] memory actual = escrow.availableActions(agreementId, actor);
        assertEq(actual.length, expected.length);
        for (uint256 i = 0; i < expected.length; i++) {
            assertEq(uint256(actual[i]), uint256(expected[i]));
        }
    }

    function _assertNoActions(bytes32 agreementId, address actor) internal view {
        assertEq(escrow.availableActions(agreementId, actor).length, 0);
    }

    function _actions1(ICamEscrowView.AgreementAction action)
        internal
        pure
        returns (ICamEscrowView.AgreementAction[] memory actions)
    {
        actions = new ICamEscrowView.AgreementAction[](1);
        actions[0] = action;
    }

    function _actions2(
        ICamEscrowView.AgreementAction first,
        ICamEscrowView.AgreementAction second
    ) internal pure returns (ICamEscrowView.AgreementAction[] memory actions) {
        actions = new ICamEscrowView.AgreementAction[](2);
        actions[0] = first;
        actions[1] = second;
    }

    function _stringOfLength(uint256 length) internal pure returns (string memory) {
        bytes memory value = new bytes(length);
        for (uint256 i = 0; i < length; i++) {
            value[i] = 0x78;
        }
        return string(value);
    }
}
