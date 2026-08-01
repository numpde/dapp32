pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {ICamEscrowView} from "../../src/ICamEscrowView.sol";
import {CamEscrowInvariantHandler} from "../support/CamEscrowInvariantHandler.sol";

/// @notice Stateful conservation and state-shape invariants for CamEscrow.
/// @dev Successful transition event/storage agreement and exact beneficiary
/// credit deltas are asserted inside the targeted handler at the mutation site.
contract CamEscrowInvariantTest is Test {
    CamEscrow private escrow;
    CamEscrowInvariantHandler private handler;

    function setUp() public {
        escrow = new CamEscrow();
        handler = new CamEscrowInvariantHandler(escrow);
        vm.deal(address(handler), 1_000_000 ether);

        for (uint256 i = 0; i < handler.actorCount(); i++) {
            vm.deal(handler.actorAt(i), 1_000_000 ether);
        }

        bytes4[] memory selectors = new bytes4[](15);
        selectors[0] = CamEscrowInvariantHandler.createAgreement.selector;
        selectors[1] = CamEscrowInvariantHandler.cancelAgreement.selector;
        selectors[2] = CamEscrowInvariantHandler.acceptAgreement.selector;
        selectors[3] = CamEscrowInvariantHandler.submitAgreement.selector;
        selectors[4] = CamEscrowInvariantHandler.approveAgreement.selector;
        selectors[5] = CamEscrowInvariantHandler.disputeAgreement.selector;
        selectors[6] = CamEscrowInvariantHandler.finalizeAcceptanceTimeout.selector;
        selectors[7] = CamEscrowInvariantHandler.finalizeWorkTimeout.selector;
        selectors[8] = CamEscrowInvariantHandler.finalizeReviewTimeout.selector;
        selectors[9] = CamEscrowInvariantHandler.resolveForClient.selector;
        selectors[10] = CamEscrowInvariantHandler.resolveForContractor.selector;
        selectors[11] = CamEscrowInvariantHandler.finalizeArbitrationTimeout.selector;
        selectors[12] = CamEscrowInvariantHandler.advanceTime.selector;
        selectors[13] = CamEscrowInvariantHandler.withdrawCredit.selector;
        selectors[14] = CamEscrowInvariantHandler.probeTerminalIrreversibility.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// @notice Every created amount has exactly one disposition: active, credited, or withdrawn.
    function invariant_accountingDispositionIsConserved() external view {
        uint256 activeAmounts;
        uint256 terminalAmounts;
        uint256 trackedAmounts;

        for (uint256 i = 0; i < handler.agreementCount(); i++) {
            CamEscrowInvariantHandler.TrackedAgreement memory tracked = handler.agreementAt(i);
            ICamEscrowView.AgreementView memory agreement = escrow.agreementById(tracked.agreementId);
            trackedAmounts += tracked.amount;

            if (_isActive(agreement.state)) activeAmounts += tracked.amount;
            else if (_isTerminal(agreement.state)) terminalAmounts += tracked.amount;
            else revert("tracked agreement is absent");
        }

        assertEq(trackedAmounts, handler.totalCreated());
        assertEq(activeAmounts, escrow.totalEscrowed());
        assertEq(terminalAmounts, escrow.totalWithdrawable() + handler.totalWithdrawn());
        assertEq(
            handler.totalCreated(),
            escrow.totalEscrowed() + escrow.totalWithdrawable() + handler.totalWithdrawn()
        );
    }

    /// @notice Aggregate per-account credits are exactly the declared withdrawable liability.
    function invariant_actorCreditsEqualTotalWithdrawable() external view {
        uint256 creditSum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            creditSum += escrow.withdrawable(handler.actorAt(i));
        }
        assertEq(creditSum, escrow.totalWithdrawable());
    }

    /// @notice The contract remains solvent; without forced value the handler keeps equality.
    function invariant_liabilitiesRemainSolvent() external view {
        uint256 liabilities = escrow.totalEscrowed() + escrow.totalWithdrawable();
        assertEq(escrow.totalLiabilities(), liabilities);
        assertLe(liabilities, address(escrow).balance);
        assertEq(address(escrow).balance, liabilities);
    }

    /// @notice Active agreements have one live deadline; terminal and absent observations have zero.
    function invariant_deadlineShapeMatchesState() external view {
        bytes32 absentId = keccak256("invariant-absent");
        ICamEscrowView.AgreementView memory absent = escrow.agreementById(absentId);
        assertEq(uint256(absent.state), uint256(ICamEscrowView.AgreementState.None));
        assertEq(absent.deadline, 0);

        for (uint256 i = 0; i < handler.agreementCount(); i++) {
            CamEscrowInvariantHandler.TrackedAgreement memory tracked = handler.agreementAt(i);
            ICamEscrowView.AgreementView memory agreement = escrow.agreementById(tracked.agreementId);
            if (_isActive(agreement.state)) assertGt(agreement.deadline, 0);
            else {
                assertTrue(_isTerminal(agreement.state));
                assertEq(agreement.deadline, 0);
            }
        }
    }

    /// @notice Terminal agreements expose no transition to any role or zero-address read context.
    function invariant_terminalStatesExposeNoActions() external view {
        for (uint256 i = 0; i < handler.agreementCount(); i++) {
            CamEscrowInvariantHandler.TrackedAgreement memory tracked = handler.agreementAt(i);
            ICamEscrowView.AgreementView memory agreement = escrow.agreementById(tracked.agreementId);
            if (!_isTerminal(agreement.state)) continue;

            assertEq(escrow.availableActions(tracked.agreementId, address(0)).length, 0);
            for (uint256 j = 0; j < handler.actorCount(); j++) {
                assertEq(
                    escrow.availableActions(tracked.agreementId, handler.actorAt(j)).length,
                    0
                );
            }
        }
    }

    function _isActive(ICamEscrowView.AgreementState state) private pure returns (bool) {
        return uint256(state) >= uint256(ICamEscrowView.AgreementState.Funded)
            && uint256(state) <= uint256(ICamEscrowView.AgreementState.Disputed);
    }

    function _isTerminal(ICamEscrowView.AgreementState state) private pure returns (bool) {
        return uint256(state) > uint256(ICamEscrowView.AgreementState.Disputed);
    }
}
