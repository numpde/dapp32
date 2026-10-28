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
    string internal constant CAM_CONTRACT_COMPONENTS = "BicycleComponents";
    string internal constant SEEDED_FRAME_SERIAL = "DEMO-FRAME-001";
    string internal constant SEEDED_BATTERY_SERIAL = "DEMO-BATTERY-001";
    string internal constant SEEDED_MOTOR_SERIAL = "DEMO-MOTOR-001";
    string internal constant SEEDED_BIKE_SERIAL = "DEMO-BIKE-001";

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

        deployment.camRoot.setContractAddress("ICamRootOwnership", address(deployment.camRoot));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER_UI, address(deployment.ui));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER, address(deployment.manager));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_COMPONENTS, address(deployment.components));
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
        string memory metadataDirectory = _metadataDirectory(camURI);
        deployment = deployLocalFixture(broadcasterAdmin, camURI, camHash);
        _seedLocalComponents(deployment.manager, seedOwner, metadataDirectory);
    }

    function _metadataDirectory(string memory camURI) private pure returns (string memory) {
        bytes memory uri = bytes(camURI);
        bytes memory suffix = bytes("/main.json");
        require(uri.length >= suffix.length, "Local Bike NFT fixture CAM URI must end with /main.json");
        uint256 start = uri.length - suffix.length;
        for (uint256 i; i < suffix.length; ++i) {
            require(uri[start + i] == suffix[i], "Local Bike NFT fixture CAM URI must end with /main.json");
        }
        bytes memory directory = new bytes(start + 1);
        for (uint256 i; i < directory.length; ++i) {
            require(uri[i] != "?" && uri[i] != "#", "Local Bike NFT fixture CAM URI cannot have a query or fragment");
            directory[i] = uri[i];
        }
        return string.concat(string(directory), "components/");
    }

    function _seedLocalComponents(BicycleComponentManager manager, address owner, string memory metadataDirectory)
        private
    {
        manager.registerComponent(owner, SEEDED_FRAME_SERIAL, string.concat(metadataDirectory, "demo-frame-001.json"));
        manager.registerComponent(
            owner, SEEDED_BATTERY_SERIAL, string.concat(metadataDirectory, "demo-battery-001.json")
        );
        manager.registerComponent(owner, SEEDED_MOTOR_SERIAL, string.concat(metadataDirectory, "demo-motor-001.json"));
        manager.registerComponent(owner, SEEDED_BIKE_SERIAL, string.concat(metadataDirectory, "demo-bike-001.json"));
    }
}
