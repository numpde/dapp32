pragma solidity 0.8.35;

import {UIReleaseScript} from "cam/script/UIReleaseScript.sol";
import {PayToPlayUI} from "../src/PayToPlayUI.sol";
import {PayToPlayUIDeployment} from "./PayToPlayUIDeployment.sol";

contract DeployUI is UIReleaseScript, PayToPlayUIDeployment {
    function _uiApp() internal pure override returns (string memory) {
        return "pay-to-play";
    }

    function _deployUI(address backing) internal override returns (address) {
        return address(deployPayToPlayUI(backing));
    }

    function _uiSourceCodeHash(address backing) internal override returns (bytes32) {
        return payToPlayUISourceCodeHash(backing);
    }

    function _uiBacking(address ui) internal view override returns (address) {
        return address(PayToPlayUI(ui).payments());
    }
}
