pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";

/// @notice UI construction and activation shared by fresh releases and UI updates.
abstract contract BikeNftUIDeployment {
    function deployBikeNftUI(address manager) internal returns (BicycleComponentManagerUI) {
        return new BicycleComponentManagerUI(manager);
    }

    function bindBikeNftUI(CamRoot root, BicycleComponentManagerUI ui) internal {
        root.setContractAddress("BicycleComponentManagerUI", address(ui));
    }
}
