pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlayUI} from "../src/PayToPlayUI.sol";

/// @notice UI construction and activation shared by fresh releases and UI updates.
abstract contract PayToPlayUIDeployment {
    function deployPayToPlayUI(address payments) internal returns (PayToPlayUI) {
        return new PayToPlayUI(payments);
    }

    function bindPayToPlayUI(CamRoot root, PayToPlayUI ui) internal {
        root.setContractAddress("PayToPlayUI", address(ui));
    }
}
