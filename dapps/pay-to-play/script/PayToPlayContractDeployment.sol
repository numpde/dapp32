pragma solidity 0.8.35;

import {PayToPlay} from "../src/PayToPlay.sol";

/// @notice Payment construction and admin nomination, independent of CAM and UI.
abstract contract PayToPlayContractDeployment {
    function deployPayToPlayContract(address deployer, uint64 nullClaimPeriod) internal returns (PayToPlay) {
        return new PayToPlay(deployer, nullClaimPeriod);
    }

    function nominatePayToPlayAdmin(PayToPlay payments, address intendedAdmin, address deployer) internal {
        if (intendedAdmin != deployer) payments.transferOwnership(intendedAdmin);
    }
}
