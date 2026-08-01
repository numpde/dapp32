pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";

import {CamEscrow} from "../src/CamEscrow.sol";
import {CamEscrowUI} from "../src/CamEscrowUI.sol";

/// @notice Shared Forge-broadcast deployment helper for the escrow CAM fixture.
/// @dev The caller must already be broadcasting as `broadcasterAdmin`, because
/// CamRoot address bindings are owner-gated. This fixture seeds no agreements;
/// all workflow state is created through the published CAM routes.
contract EscrowLocalFixture {
    string internal constant CAM_CONTRACT_ESCROW = "CamEscrow";
    string internal constant CAM_CONTRACT_ESCROW_UI = "CamEscrowUI";

    struct Deployment {
        CamRoot camRoot;
        CamEscrow escrow;
        CamEscrowUI ui;
    }

    function deployLocalFixture(address broadcasterAdmin, string memory camURI, bytes32 camHash)
        internal
        returns (Deployment memory deployment)
    {
        deployment.camRoot = new CamRoot(broadcasterAdmin, camURI, camHash);
        deployment.escrow = new CamEscrow();
        deployment.ui = new CamEscrowUI(address(deployment.escrow));

        deployment.camRoot.setContractAddress(CAM_CONTRACT_ESCROW_UI, address(deployment.ui));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_ESCROW, address(deployment.escrow));
    }
}
