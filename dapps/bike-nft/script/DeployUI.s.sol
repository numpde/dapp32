pragma solidity 0.8.35;

import {UIReleaseScript} from "cam/script/UIReleaseScript.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";
import {BikeNftUIDeployment} from "./BikeNftUIDeployment.sol";

contract DeployUI is UIReleaseScript, BikeNftUIDeployment {
    function _uiApp() internal pure override returns (string memory) {
        return "bike-nft";
    }

    function _deployUI(address backing) internal override returns (address) {
        return address(deployBikeNftUI(backing));
    }

    function _uiSourceCodeHash(address backing) internal override returns (bytes32) {
        return bikeNftUISourceCodeHash(backing);
    }

    function _uiBacking(address ui) internal view override returns (address) {
        return address(BicycleComponentManagerUI(payable(ui)).manager());
    }
}
