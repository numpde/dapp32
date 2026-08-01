pragma solidity 0.8.35;

import {EscrowDeployment} from "./EscrowDeployment.sol";

/// @notice Shared Forge-broadcast deployment helper for the escrow CAM fixture.
/// @dev The caller must already be broadcasting as `broadcasterAdmin`, because
/// CamRoot address bindings are owner-gated. This fixture seeds no agreements;
/// all workflow state is created through the published CAM routes.
contract EscrowLocalFixture is EscrowDeployment {
    function deployLocalFixture(address broadcasterAdmin, string memory camURI, bytes32 camHash)
        internal
        returns (Deployment memory deployment)
    {
        return deployEscrow(broadcasterAdmin, camURI, camHash);
    }
}
