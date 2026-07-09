pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";
import {BicycleComponentManager} from "../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../src/BicycleComponents.sol";

/// @notice Shared Forge-broadcast deployment helpers for the bike NFT CAM example.
/// @dev
/// This contract owns only the shared setup logic for a caller that is already
/// broadcasting as the fixture admin. The role grants and CAM root bindings
/// below are admin/owner-gated calls, so `broadcasterAdmin` must be the active
/// Forge broadcaster used for the script run.
contract BikeNftLocalFixture {
    uint48 internal constant LOCAL_ADMIN_DELAY = 0;

    string internal constant CAM_CONTRACT_MANAGER = "BicycleComponentManager";
    string internal constant CAM_CONTRACT_MANAGER_UI = "BicycleComponentManagerUI";
    string internal constant SEEDED_FRAME_SERIAL = "DEMO-FRAME-001";
    string internal constant SEEDED_BATTERY_SERIAL = "DEMO-BATTERY-001";
    string internal constant SEEDED_MOTOR_SERIAL = "DEMO-MOTOR-001";

    struct Deployment {
        CamRoot camRoot;
        BicycleComponents components;
        BicycleComponentManager manager;
        BicycleComponentManagerUI ui;
    }

    function deployLocalFixture(address broadcasterAdmin, string memory camURI, bytes32 camHash)
        internal
        returns (Deployment memory deployment)
    {
        deployment.camRoot = new CamRoot(broadcasterAdmin, camURI, camHash);

        deployment.components = new BicycleComponents({
            tokenName: "Bicycle Components",
            tokenSymbol: "BIKE",
            admin: broadcasterAdmin,
            adminDelay: LOCAL_ADMIN_DELAY,
            baseTokenURI: "",
            collectionURI: ""
        });

        deployment.manager = new BicycleComponentManager({
            admin: broadcasterAdmin, adminDelay: LOCAL_ADMIN_DELAY, componentsAddress_: address(deployment.components)
        });

        deployment.ui = new BicycleComponentManagerUI(address(deployment.manager));

        deployment.components.grantRole(deployment.components.MINTER_ROLE(), address(deployment.manager));
        deployment.components.grantRole(deployment.components.TOKEN_URI_SETTER_ROLE(), address(deployment.manager));
        deployment.manager.grantRole(deployment.manager.REGISTRAR_ROLE(), broadcasterAdmin);

        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER_UI, address(deployment.ui));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER, address(deployment.manager));
    }

    /// @dev Keep deployment authority separate from seeded ownership: the
    /// manager now uses safe minting, so `seedOwner` must be able to receive
    /// ERC-721s when it is a contract.
    function deploySeededLocalFixture(
        address broadcasterAdmin,
        address seedOwner,
        string memory camURI,
        bytes32 camHash
    ) internal returns (Deployment memory deployment) {
        deployment = deployLocalFixture(broadcasterAdmin, camURI, camHash);
        _seedLocalComponents(deployment.manager, seedOwner);
    }

    function _seedLocalComponents(BicycleComponentManager manager, address owner) private {
        manager.registerComponent(owner, SEEDED_FRAME_SERIAL, "fixture://bike-nft/components/demo-frame-001.json");
        manager.registerComponent(owner, SEEDED_BATTERY_SERIAL, "fixture://bike-nft/components/demo-battery-001.json");
        manager.registerComponent(owner, SEEDED_MOTOR_SERIAL, "fixture://bike-nft/components/demo-motor-001.json");
    }
}
