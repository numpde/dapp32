pragma solidity 0.8.35;

import {BicycleComponents} from "../src/BicycleComponents.sol";
import {BicycleComponentManager} from "../src/BicycleComponentManager.sol";

/// @notice Business construction, permissions and admin nominations, independent of CAM and UI.
abstract contract BikeNftContractDeployment {
    struct ContractSettings {
        string tokenName;
        string tokenSymbol;
        string baseTokenURI;
        string collectionURI;
        address intendedComponentsAdmin;
        uint48 componentsAdminDelay;
        address componentsPauser;
        address componentsConfigurer;
        address intendedManagerAdmin;
        uint48 managerAdminDelay;
        address managerPauser;
        address managerConfigurer;
        address[] registrars;
    }

    struct Contracts {
        BicycleComponents components;
        BicycleComponentManager manager;
    }

    function deployBikeNftContracts(ContractSettings memory settings, address deployer)
        internal
        returns (Contracts memory contracts)
    {
        contracts.components = new BicycleComponents(
            settings.tokenName,
            settings.tokenSymbol,
            deployer,
            settings.componentsAdminDelay,
            settings.baseTokenURI,
            settings.collectionURI
        );
        contracts.manager =
            new BicycleComponentManager(deployer, settings.managerAdminDelay, address(contracts.components));
    }

    function configureBikeNftContracts(Contracts memory contracts, ContractSettings memory settings, address deployer)
        internal
    {
        contracts.components.grantRole(contracts.components.MINTER_ROLE(), address(contracts.manager));
        contracts.components.grantRole(contracts.components.TOKEN_URI_SETTER_ROLE(), address(contracts.manager));
        contracts.components.grantRole(contracts.components.PAUSER_ROLE(), settings.componentsPauser);
        contracts.components.grantRole(contracts.components.CONFIGURER_ROLE(), settings.componentsConfigurer);
        contracts.manager.grantRole(contracts.manager.PAUSER_ROLE(), settings.managerPauser);
        contracts.manager.grantRole(contracts.manager.CONFIGURER_ROLE(), settings.managerConfigurer);
        for (uint256 i = 0; i < settings.registrars.length; i++) {
            contracts.manager.grantRole(contracts.manager.REGISTRAR_ROLE(), settings.registrars[i]);
        }
        if (settings.componentsPauser != deployer) {
            contracts.components.revokeRole(contracts.components.PAUSER_ROLE(), deployer);
        }
        if (settings.componentsConfigurer != deployer) {
            contracts.components.revokeRole(contracts.components.CONFIGURER_ROLE(), deployer);
        }
        if (settings.managerPauser != deployer) {
            contracts.manager.revokeRole(contracts.manager.PAUSER_ROLE(), deployer);
        }
        if (settings.managerConfigurer != deployer) {
            contracts.manager.revokeRole(contracts.manager.CONFIGURER_ROLE(), deployer);
        }
    }

    function nominateBikeNftAdmins(Contracts memory contracts, ContractSettings memory settings, address deployer)
        internal
    {
        if (settings.intendedComponentsAdmin != deployer) {
            contracts.components.beginDefaultAdminTransfer(settings.intendedComponentsAdmin);
        }
        if (settings.intendedManagerAdmin != deployer) {
            contracts.manager.beginDefaultAdminTransfer(settings.intendedManagerAdmin);
        }
    }
}
