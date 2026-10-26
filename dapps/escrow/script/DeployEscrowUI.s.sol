pragma solidity 0.8.35;

import {UIReleaseScript} from "cam/script/UIReleaseScript.sol";
import {CamEscrowUI} from "../src/CamEscrowUI.sol";
import {EscrowDeployment} from "./EscrowDeployment.sol";

contract DeployEscrowUI is UIReleaseScript, EscrowDeployment {
    function _uiApp() internal pure override returns (string memory) {
        return "escrow";
    }

    function _deployUI(address backing) internal override returns (address) {
        return address(deployEscrowUI(backing));
    }

    function _uiSourceCodeHash(address backing) internal override returns (bytes32) {
        return escrowUISourceCodeHash(backing);
    }

    function _uiBacking(address ui) internal view override returns (address) {
        return address(CamEscrowUI(payable(ui)).escrow());
    }
}
