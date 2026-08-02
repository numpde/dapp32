pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";

import {CamRoot} from "cam/src/CamRoot.sol";
import {BicycleComponentManager} from "../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../src/BicycleComponents.sol";

/// @notice Deploys an unseeded, pinned Bike NFT release and starts every authority handoff.
/// @dev The broadcaster is only a bootstrap authority. Verification remains incomplete until
/// CamRoot ownership and both delayed default-admin transfers are accepted independently.
contract DeployBikeNftRelease is Script {
    string private constant RELEASE_PLAN_SCHEMA = "bike-nft.release-plan.v1";
    string private constant CAM_ROOT_PATH = "bike-nft/cam/main.json";
    string private constant CAM_CONTRACT_MANAGER = "BicycleComponentManager";
    string private constant CAM_CONTRACT_MANAGER_UI = "BicycleComponentManagerUI";

    struct ReleasePlan {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        bytes32 camHash;
        address camRootOwner;
        string tokenName;
        string tokenSymbol;
        string baseTokenURI;
        string collectionURI;
        address componentsAdmin;
        uint48 componentsAdminDelay;
        address componentsPauser;
        address componentsConfigurer;
        address managerAdmin;
        uint48 managerAdminDelay;
        address managerPauser;
        address managerConfigurer;
        address[] registrars;
    }

    struct Deployment {
        CamRoot camRoot;
        BicycleComponents components;
        BicycleComponentManager manager;
        BicycleComponentManagerUI ui;
    }

    error InvalidReleasePlanSchema(string actual);
    error InvalidSourceCommit(string sourceCommit);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error UnsupportedReleaseChainId(uint256 chainId);
    error CamHashSourceMismatch(bytes32 planned, bytes32 source);
    error ZeroCamHash();
    error EmptyValue(string field);
    error ZeroAddress(string field);
    error ZeroAdminDelay(string field);
    error AdminDelayOutOfRange(string field, uint256 value);
    error NoRegistrars();
    error DuplicateRegistrar(address registrar);
    error DeployerRetainsAuthority(string field);

    function run() external returns (Deployment memory deployment) {
        ReleasePlan memory plan = _readEnvironment();
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        _validatePlan(plan, deployer);

        vm.startBroadcast(deployerKey);
        deployment.camRoot = new CamRoot(deployer, plan.camURI, plan.camHash);
        deployment.components = new BicycleComponents(
            plan.tokenName, plan.tokenSymbol, deployer, plan.componentsAdminDelay, plan.baseTokenURI, plan.collectionURI
        );
        deployment.manager =
            new BicycleComponentManager(deployer, plan.managerAdminDelay, address(deployment.components));
        deployment.ui = new BicycleComponentManagerUI(address(deployment.manager));

        deployment.components.grantRole(deployment.components.MINTER_ROLE(), address(deployment.manager));
        deployment.components.grantRole(deployment.components.TOKEN_URI_SETTER_ROLE(), address(deployment.manager));
        deployment.components.grantRole(deployment.components.PAUSER_ROLE(), plan.componentsPauser);
        deployment.components.grantRole(deployment.components.CONFIGURER_ROLE(), plan.componentsConfigurer);
        deployment.manager.grantRole(deployment.manager.PAUSER_ROLE(), plan.managerPauser);
        deployment.manager.grantRole(deployment.manager.CONFIGURER_ROLE(), plan.managerConfigurer);
        for (uint256 i = 0; i < plan.registrars.length; i++) {
            deployment.manager.grantRole(deployment.manager.REGISTRAR_ROLE(), plan.registrars[i]);
        }

        deployment.components.revokeRole(deployment.components.PAUSER_ROLE(), deployer);
        deployment.components.revokeRole(deployment.components.CONFIGURER_ROLE(), deployer);
        deployment.manager.revokeRole(deployment.manager.PAUSER_ROLE(), deployer);
        deployment.manager.revokeRole(deployment.manager.CONFIGURER_ROLE(), deployer);

        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER, address(deployment.manager));
        deployment.camRoot.setContractAddress(CAM_CONTRACT_MANAGER_UI, address(deployment.ui));
        deployment.camRoot.transferOwnership(plan.camRootOwner);
        deployment.components.beginDefaultAdminTransfer(plan.componentsAdmin);
        deployment.manager.beginDefaultAdminTransfer(plan.managerAdmin);
        vm.stopBroadcast();

        console2.log("SourceCommit", plan.sourceCommit);
        console2.log("ChainId", block.chainid);
        console2.log("Deployer", deployer);
        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("BicycleComponents", address(deployment.components));
        console2.log("BicycleComponentManager", address(deployment.manager));
        console2.log("BicycleComponentManagerUI", address(deployment.ui));
    }

    function _readEnvironment() private view returns (ReleasePlan memory plan) {
        string memory schema = vm.envString("BIKE_NFT_RELEASE_PLAN_SCHEMA");
        if (keccak256(bytes(schema)) != keccak256(bytes(RELEASE_PLAN_SCHEMA))) {
            revert InvalidReleasePlanSchema(schema);
        }
        plan.sourceCommit = vm.envString("BIKE_NFT_RELEASE_SOURCE_COMMIT");
        plan.expectedChainId = vm.envUint("BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID");
        plan.camURI = vm.envString("BIKE_NFT_RELEASE_CAM_URI");
        plan.camHash = vm.envBytes32("BIKE_NFT_RELEASE_CAM_HASH");
        plan.camRootOwner = vm.envAddress("BIKE_NFT_RELEASE_CAM_ROOT_OWNER");
        plan.tokenName = vm.envString("BIKE_NFT_RELEASE_TOKEN_NAME");
        plan.tokenSymbol = vm.envString("BIKE_NFT_RELEASE_TOKEN_SYMBOL");
        plan.baseTokenURI = vm.envString("BIKE_NFT_RELEASE_BASE_TOKEN_URI");
        plan.collectionURI = vm.envString("BIKE_NFT_RELEASE_COLLECTION_URI");
        plan.componentsAdmin = vm.envAddress("BIKE_NFT_RELEASE_COMPONENTS_ADMIN");
        uint256 componentsAdminDelay = vm.envUint("BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY");
        if (componentsAdminDelay > type(uint48).max) {
            revert AdminDelayOutOfRange("componentsAdminDelay", componentsAdminDelay);
        }
        plan.componentsAdminDelay = uint48(componentsAdminDelay);
        plan.componentsPauser = vm.envAddress("BIKE_NFT_RELEASE_COMPONENTS_PAUSER");
        plan.componentsConfigurer = vm.envAddress("BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER");
        plan.managerAdmin = vm.envAddress("BIKE_NFT_RELEASE_MANAGER_ADMIN");
        uint256 managerAdminDelay = vm.envUint("BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY");
        if (managerAdminDelay > type(uint48).max) {
            revert AdminDelayOutOfRange("managerAdminDelay", managerAdminDelay);
        }
        plan.managerAdminDelay = uint48(managerAdminDelay);
        plan.managerPauser = vm.envAddress("BIKE_NFT_RELEASE_MANAGER_PAUSER");
        plan.managerConfigurer = vm.envAddress("BIKE_NFT_RELEASE_MANAGER_CONFIGURER");
        plan.registrars = vm.envAddress("BIKE_NFT_RELEASE_REGISTRARS", ",");
    }

    function _validatePlan(ReleasePlan memory plan, address deployer) internal view {
        if (!_isSourceCommit(plan.sourceCommit)) revert InvalidSourceCommit(plan.sourceCommit);
        if (plan.expectedChainId != block.chainid) revert ChainIdMismatch(plan.expectedChainId, block.chainid);
        if (plan.expectedChainId == 1337 || plan.expectedChainId == 31337) {
            revert UnsupportedReleaseChainId(plan.expectedChainId);
        }
        if (plan.camHash == bytes32(0)) revert ZeroCamHash();
        _requireText(plan.camURI, "camURI");
        _requireText(plan.tokenName, "tokenName");
        _requireText(plan.tokenSymbol, "tokenSymbol");
        _requireText(plan.baseTokenURI, "baseTokenURI");
        _requireText(plan.collectionURI, "collectionURI");
        _requireAddress(plan.camRootOwner, "camRootOwner");
        _requireAddress(plan.componentsAdmin, "componentsAdmin");
        _requireAddress(plan.componentsPauser, "componentsPauser");
        _requireAddress(plan.componentsConfigurer, "componentsConfigurer");
        _requireAddress(plan.managerAdmin, "managerAdmin");
        _requireAddress(plan.managerPauser, "managerPauser");
        _requireAddress(plan.managerConfigurer, "managerConfigurer");
        if (plan.componentsAdminDelay == 0) revert ZeroAdminDelay("componentsAdminDelay");
        if (plan.managerAdminDelay == 0) revert ZeroAdminDelay("managerAdminDelay");
        if (plan.registrars.length == 0) revert NoRegistrars();

        _rejectDeployer(deployer, plan.camRootOwner, "camRootOwner");
        _rejectDeployer(deployer, plan.componentsAdmin, "componentsAdmin");
        _rejectDeployer(deployer, plan.componentsPauser, "componentsPauser");
        _rejectDeployer(deployer, plan.componentsConfigurer, "componentsConfigurer");
        _rejectDeployer(deployer, plan.managerAdmin, "managerAdmin");
        _rejectDeployer(deployer, plan.managerPauser, "managerPauser");
        _rejectDeployer(deployer, plan.managerConfigurer, "managerConfigurer");
        for (uint256 i = 0; i < plan.registrars.length; i++) {
            _requireAddress(plan.registrars[i], "registrar");
            _rejectDeployer(deployer, plan.registrars[i], "registrar");
            for (uint256 j = 0; j < i; j++) {
                if (plan.registrars[i] == plan.registrars[j]) revert DuplicateRegistrar(plan.registrars[i]);
            }
        }

        bytes32 sourceCamHash = keccak256(vm.readFileBinary(CAM_ROOT_PATH));
        if (plan.camHash != sourceCamHash) revert CamHashSourceMismatch(plan.camHash, sourceCamHash);
    }

    function _requireText(string memory value, string memory field) private pure {
        if (bytes(value).length == 0) revert EmptyValue(field);
    }

    function _requireAddress(address value, string memory field) private pure {
        if (value == address(0)) revert ZeroAddress(field);
    }

    function _rejectDeployer(address deployer, address authority, string memory field) private pure {
        if (deployer == authority) revert DeployerRetainsAuthority(field);
    }

    function _isSourceCommit(string memory value) private pure returns (bool) {
        bytes memory characters = bytes(value);
        if (characters.length != 40) return false;
        for (uint256 i = 0; i < characters.length; i++) {
            uint8 character = uint8(characters[i]);
            if (!((character >= 48 && character <= 57) || (character >= 97 && character <= 102))) return false;
        }
        return true;
    }
}
