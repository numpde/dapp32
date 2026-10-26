pragma solidity 0.8.35;

import {CamEscrow} from "../src/CamEscrow.sol";

/// @notice Agreement escrow construction, independent of CAM and UI.
abstract contract EscrowContractDeployment {
    function deployEscrowContract() internal returns (CamEscrow) {
        return new CamEscrow();
    }
}
