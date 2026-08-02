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
        address intendedCamRootOwner;
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

    struct OperatorInputs {
        string sourceCommit;
        uint256 expectedChainId;
        string camURI;
        address intendedCamRootOwner;
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

    struct Deployment {
        CamRoot camRoot;
        BicycleComponents components;
        BicycleComponentManager manager;
        BicycleComponentManagerUI ui;
    }

    error InvalidReleasePlanSchema(string actual);
    error OperatorInputMismatch(string field);
    error InvalidSourceCommit(string sourceCommit);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error UnsupportedReleaseChainId(uint256 chainId);
    error CamHashSourceMismatch(bytes32 planned, bytes32 source);
    error ZeroCamHash();
    error EmptyValue(string field);
    error LineBreakInValue(string field);
    error ZeroAddress(string field);
    error ZeroAdminDelay(string field);
    error AdminDelayOutOfRange(string field, uint256 value);
    error NoRegistrars();
    error DuplicateRegistrar(address registrar);
    error DeployerRetainsAuthority(string field);

    function run() external returns (Deployment memory deployment) {
        ReleasePlan memory plan = _readPlan(vm.envString("BIKE_NFT_RELEASE_PLAN_PATH"));
        _requireOperatorInputs(plan, _readOperatorInputs());
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        _validatePlan(plan, deployer);

        vm.startBroadcast(deployerKey);
        deployment = _deployRelease(plan, deployer);
        vm.stopBroadcast();

        console2.log("SourceCommit", plan.sourceCommit);
        console2.log("ChainId", block.chainid);
        console2.log("Deployer", deployer);
        console2.log("CamRoot", address(deployment.camRoot));
        console2.log("BicycleComponents", address(deployment.components));
        console2.log("BicycleComponentManager", address(deployment.manager));
        console2.log("BicycleComponentManagerUI", address(deployment.ui));
    }

    function _deployRelease(ReleasePlan memory plan, address deployer) internal returns (Deployment memory deployment) {
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
        deployment.camRoot.transferOwnership(plan.intendedCamRootOwner);
        deployment.components.beginDefaultAdminTransfer(plan.intendedComponentsAdmin);
        deployment.manager.beginDefaultAdminTransfer(plan.intendedManagerAdmin);
    }

    function _readPlan(string memory path) internal view returns (ReleasePlan memory plan) {
        return _parsePlan(vm.readFile(path));
    }

    function _parsePlan(string memory json) internal view returns (ReleasePlan memory plan) {
        string memory schema = vm.parseJsonString(json, ".schema");
        if (keccak256(bytes(schema)) != keccak256(bytes(RELEASE_PLAN_SCHEMA))) {
            revert InvalidReleasePlanSchema(schema);
        }
        plan.sourceCommit = vm.parseJsonString(json, ".sourceCommit");
        plan.expectedChainId = vm.parseJsonUint(json, ".expectedChainId");
        plan.camURI = vm.parseJsonString(json, ".camURI");
        plan.camHash = vm.parseJsonBytes32(json, ".camHash");
        plan.intendedCamRootOwner = vm.parseJsonAddress(json, ".intendedCamRootOwner");
        plan.tokenName = vm.parseJsonString(json, ".tokenName");
        plan.tokenSymbol = vm.parseJsonString(json, ".tokenSymbol");
        plan.baseTokenURI = vm.parseJsonString(json, ".baseTokenURI");
        plan.collectionURI = vm.parseJsonString(json, ".collectionURI");
        plan.intendedComponentsAdmin = vm.parseJsonAddress(json, ".intendedComponentsAdmin");
        plan.componentsAdminDelay = _readDelay(json, ".componentsAdminDelay");
        plan.componentsPauser = vm.parseJsonAddress(json, ".componentsPauser");
        plan.componentsConfigurer = vm.parseJsonAddress(json, ".componentsConfigurer");
        plan.intendedManagerAdmin = vm.parseJsonAddress(json, ".intendedManagerAdmin");
        plan.managerAdminDelay = _readDelay(json, ".managerAdminDelay");
        plan.managerPauser = vm.parseJsonAddress(json, ".managerPauser");
        plan.managerConfigurer = vm.parseJsonAddress(json, ".managerConfigurer");
        plan.registrars = vm.parseJsonAddressArray(json, ".registrars");
    }

    function _readDelay(string memory json, string memory field) internal view returns (uint48) {
        uint256 value = vm.parseJsonUint(json, field);
        if (value > type(uint48).max) revert AdminDelayOutOfRange(field, value);
        return uint48(value);
    }

    function _readOperatorInputs() private view returns (OperatorInputs memory inputs) {
        inputs.sourceCommit = vm.envString("BIKE_NFT_RELEASE_SOURCE_COMMIT");
        inputs.expectedChainId = vm.envUint("BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID");
        inputs.camURI = vm.envString("BIKE_NFT_RELEASE_CAM_URI");
        inputs.intendedCamRootOwner = vm.envAddress("BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER");
        inputs.tokenName = vm.envString("BIKE_NFT_RELEASE_TOKEN_NAME");
        inputs.tokenSymbol = vm.envString("BIKE_NFT_RELEASE_TOKEN_SYMBOL");
        inputs.baseTokenURI = vm.envString("BIKE_NFT_RELEASE_BASE_TOKEN_URI");
        inputs.collectionURI = vm.envString("BIKE_NFT_RELEASE_COLLECTION_URI");
        inputs.intendedComponentsAdmin = vm.envAddress("BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN");
        inputs.componentsAdminDelay =
            _readOperatorDelay("componentsAdminDelay", "BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY");
        inputs.componentsPauser = vm.envAddress("BIKE_NFT_RELEASE_COMPONENTS_PAUSER");
        inputs.componentsConfigurer = vm.envAddress("BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER");
        inputs.intendedManagerAdmin = vm.envAddress("BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN");
        inputs.managerAdminDelay = _readOperatorDelay("managerAdminDelay", "BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY");
        inputs.managerPauser = vm.envAddress("BIKE_NFT_RELEASE_MANAGER_PAUSER");
        inputs.managerConfigurer = vm.envAddress("BIKE_NFT_RELEASE_MANAGER_CONFIGURER");
        inputs.registrars = vm.envAddress("BIKE_NFT_RELEASE_REGISTRARS", ",");
    }

    function _readOperatorDelay(string memory field, string memory variableName) private view returns (uint48) {
        uint256 value = vm.envUint(variableName);
        if (value > type(uint48).max) revert AdminDelayOutOfRange(field, value);
        return uint48(value);
    }

    function _requireOperatorInputs(ReleasePlan memory plan, OperatorInputs memory inputs) internal pure {
        _requireOperatorString("sourceCommit", plan.sourceCommit, inputs.sourceCommit);
        _requireOperatorUint("expectedChainId", plan.expectedChainId, inputs.expectedChainId);
        _requireOperatorString("camURI", plan.camURI, inputs.camURI);
        _requireOperatorAddress("intendedCamRootOwner", plan.intendedCamRootOwner, inputs.intendedCamRootOwner);
        _requireOperatorString("tokenName", plan.tokenName, inputs.tokenName);
        _requireOperatorString("tokenSymbol", plan.tokenSymbol, inputs.tokenSymbol);
        _requireOperatorString("baseTokenURI", plan.baseTokenURI, inputs.baseTokenURI);
        _requireOperatorString("collectionURI", plan.collectionURI, inputs.collectionURI);
        _requireOperatorAddress("intendedComponentsAdmin", plan.intendedComponentsAdmin, inputs.intendedComponentsAdmin);
        _requireOperatorUint("componentsAdminDelay", plan.componentsAdminDelay, inputs.componentsAdminDelay);
        _requireOperatorAddress("componentsPauser", plan.componentsPauser, inputs.componentsPauser);
        _requireOperatorAddress("componentsConfigurer", plan.componentsConfigurer, inputs.componentsConfigurer);
        _requireOperatorAddress("intendedManagerAdmin", plan.intendedManagerAdmin, inputs.intendedManagerAdmin);
        _requireOperatorUint("managerAdminDelay", plan.managerAdminDelay, inputs.managerAdminDelay);
        _requireOperatorAddress("managerPauser", plan.managerPauser, inputs.managerPauser);
        _requireOperatorAddress("managerConfigurer", plan.managerConfigurer, inputs.managerConfigurer);
        if (plan.registrars.length != inputs.registrars.length) revert OperatorInputMismatch("registrars");
        for (uint256 i = 0; i < plan.registrars.length; i++) {
            if (plan.registrars[i] != inputs.registrars[i]) revert OperatorInputMismatch("registrars");
        }
    }

    function _requireOperatorString(string memory field, string memory actual, string memory expected) private pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(expected))) revert OperatorInputMismatch(field);
    }

    function _requireOperatorAddress(string memory field, address actual, address expected) private pure {
        if (actual != expected) revert OperatorInputMismatch(field);
    }

    function _requireOperatorUint(string memory field, uint256 actual, uint256 expected) private pure {
        if (actual != expected) revert OperatorInputMismatch(field);
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
        _requireAddress(plan.intendedCamRootOwner, "intendedCamRootOwner");
        _requireAddress(plan.intendedComponentsAdmin, "intendedComponentsAdmin");
        _requireAddress(plan.componentsPauser, "componentsPauser");
        _requireAddress(plan.componentsConfigurer, "componentsConfigurer");
        _requireAddress(plan.intendedManagerAdmin, "intendedManagerAdmin");
        _requireAddress(plan.managerPauser, "managerPauser");
        _requireAddress(plan.managerConfigurer, "managerConfigurer");
        if (plan.componentsAdminDelay == 0) revert ZeroAdminDelay("componentsAdminDelay");
        if (plan.managerAdminDelay == 0) revert ZeroAdminDelay("managerAdminDelay");
        if (plan.registrars.length == 0) revert NoRegistrars();

        _rejectDeployer(deployer, plan.intendedCamRootOwner, "intendedCamRootOwner");
        _rejectDeployer(deployer, plan.intendedComponentsAdmin, "intendedComponentsAdmin");
        _rejectDeployer(deployer, plan.componentsPauser, "componentsPauser");
        _rejectDeployer(deployer, plan.componentsConfigurer, "componentsConfigurer");
        _rejectDeployer(deployer, plan.intendedManagerAdmin, "intendedManagerAdmin");
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
        bytes memory characters = bytes(value);
        if (characters.length == 0) revert EmptyValue(field);
        for (uint256 i = 0; i < characters.length; i++) {
            if (characters[i] == 0x0a || characters[i] == 0x0d) revert LineBreakInValue(field);
        }
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
