pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";

import {CamEscrow} from "../src/CamEscrow.sol";
import {CamEscrowUI} from "../src/CamEscrowUI.sol";
import {EscrowContractDeployment} from "./EscrowContractDeployment.sol";

/// @notice Shared contract-construction wiring for local and release scripts.
/// @dev The active broadcaster must equal `camRootOwner`, because the two CAM
/// contract bindings are owner-gated immediately after construction.
abstract contract EscrowDeployment is EscrowContractDeployment {
    string internal constant CAM_CONTRACT_ESCROW = "CamEscrow";
    string internal constant CAM_CONTRACT_ESCROW_UI = "CamEscrowUI";

    struct Deployment {
        CamRoot camRoot;
        CamEscrow escrow;
        CamEscrowUI ui;
    }

    function deployEscrow(address camRootOwner, string memory camURI, bytes32 camHash)
        internal
        returns (Deployment memory deployment)
    {
        deployment.camRoot = new CamRoot(camRootOwner, camURI, camHash);
        deployment.escrow = deployEscrowContract();
        deployment.ui = deployEscrowUI(address(deployment.escrow));

        bindEscrowUI(deployment.camRoot, deployment.ui);
        deployment.camRoot.setContractAddress(CAM_CONTRACT_ESCROW, address(deployment.escrow));
    }

    function deployEscrowUI(address escrow) internal returns (CamEscrowUI) {
        return new CamEscrowUI(escrow);
    }

    function bindEscrowUI(CamRoot root, CamEscrowUI ui) internal {
        root.setContractAddress(CAM_CONTRACT_ESCROW_UI, address(ui));
    }

    function escrowUISourceCodeHash(address escrow) internal returns (bytes32) {
        return address(deployEscrowUI(escrow)).codehash;
    }
}
