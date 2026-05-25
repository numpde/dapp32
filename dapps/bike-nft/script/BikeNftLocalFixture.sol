pragma solidity 0.8.35;

import {CamRoot} from "cam/src/CamRoot.sol";
import {BicycleComponentManager} from "../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../src/BicycleComponents.sol";

/// @notice Reusable local deployment fixture for the bike NFT CAM example.
/// @dev
/// This contract owns only the shared setup logic. Executable scripts and
/// scenario tests should call this fixture instead of duplicating deployment
/// order, role grants, or CAM root bindings.
contract BikeNftLocalFixture {
    uint48 internal constant LOCAL_ADMIN_DELAY = 0;

    string internal constant CAM_CONTRACT_MANAGER = "BicycleComponentManager";
    string internal constant CAM_CONTRACT_MANAGER_UI = "BicycleComponentManagerUI";

    struct Deployment {
        CamRoot camRoot;
        BicycleComponents components;
        BicycleComponentManager manager;
        BicycleComponentManagerUI ui;
    }

    function deployLocalFixture(address admin, string memory camURI, bytes32 camHash)
        internal
        returns (Deployment memory deployment)
    {
        deployment.camRoot = new CamRoot(admin, camURI, camHash);

        deployment.components = new BicycleComponents({
            tokenName: "Bicycle Components",
            tokenSymbol: "BIKE",
            admin: admin,
            adminDelay: LOCAL_ADMIN_DELAY,
            baseTokenURI: "",
            collectionURI: ""
        });

        deployment.manager = new BicycleComponentManager({
            admin: admin, adminDelay: LOCAL_ADMIN_DELAY, defaultComponents_: address(deployment.components)
        });

        deployment.ui = new BicycleComponentManagerUI(address(deployment.manager));

        deployment.components.grantRole(deployment.components.MINTER_ROLE(), address(deployment.manager));
        deployment.components.grantRole(deployment.components.TOKEN_URI_SETTER_ROLE(), address(deployment.manager));

        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER_UI, address(deployment.ui));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER, address(deployment.manager));
    }
}
