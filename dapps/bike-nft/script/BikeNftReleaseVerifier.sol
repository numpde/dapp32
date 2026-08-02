pragma solidity 0.8.35;

import {
    IAccessControlDefaultAdminRules
} from "@openzeppelin-contracts-5.6.1/access/extensions/IAccessControlDefaultAdminRules.sol";
import {IERC721Metadata} from "@openzeppelin-contracts-5.6.1/token/ERC721/extensions/IERC721Metadata.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

import {CamRoot} from "cam/src/CamRoot.sol";
import {ICamApp} from "cam/src/ICamApp.sol";
import {BicycleComponentManager} from "../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../src/BicycleComponentManagerUI.sol";
import {BicycleComponents} from "../src/BicycleComponents.sol";
import {IBicycleComponentManagerView} from "../src/IBicycleComponentManagerView.sol";
import {IBicycleComponents} from "../src/IBicycleComponents.sol";

/// @notice Read-only acceptance checks for one Bike NFT release.
/// @dev Reference contracts are created only inside Forge simulation. The verification lane never broadcasts.
abstract contract BikeNftReleaseVerifier {
    string internal constant DEPLOYMENT_SCHEMA = "bike-nft.deployment.v1";
    string private constant CAM_CONTRACT_MANAGER = "BicycleComponentManager";
    string private constant CAM_CONTRACT_MANAGER_UI = "BicycleComponentManagerUI";

    struct Artifact {
        string sourceCommit;
        uint256 chainId;
        address deployer;
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
        address camRoot;
        address components;
        address manager;
        address ui;
        bytes32 camRootCodeHash;
        bytes32 componentsCodeHash;
        bytes32 managerCodeHash;
        bytes32 uiCodeHash;
    }

    error InvalidArtifactSchema(string actual);
    error SourceCommitMismatch(string expected, string actual);
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error UnsupportedReleaseChainId(uint256 chainId);
    error EmptyValue(string field);
    error ZeroValue(string field);
    error MissingCode(string field, address target);
    error CodeHashMismatch(string field, bytes32 expected, bytes32 actual);
    error ValueMismatch(string field);
    error AddressMismatch(string field, address expected, address actual);
    error PendingAuthority(string field, address pending);
    error DelayMismatch(string field, uint48 expected, uint48 actual);
    error RoleMismatch(string field, bytes32 role, address account, bool expected);
    error UnsupportedInterface(string field, bytes4 interfaceId);
    error PendingAdminDelay(string field, uint48 delay, uint48 schedule);

    function requireDeploymentSchema(string memory actual) internal pure {
        if (keccak256(bytes(actual)) != keccak256(bytes(DEPLOYMENT_SCHEMA))) {
            revert InvalidArtifactSchema(actual);
        }
    }

    function verifyArtifact(Artifact memory artifact, string memory expectedSourceCommit) internal {
        _verifyIdentity(artifact, expectedSourceCommit);
        _verifyCode(artifact);
        _verifyCamRoot(artifact);
        _verifyComponents(artifact);
        _verifyManager(artifact);
        _verifyInterfaces(artifact);
        _verifySourceCode(artifact);
    }

    function _verifyIdentity(Artifact memory artifact, string memory expectedSourceCommit) private view {
        if (keccak256(bytes(artifact.sourceCommit)) != keccak256(bytes(expectedSourceCommit))) {
            revert SourceCommitMismatch(expectedSourceCommit, artifact.sourceCommit);
        }
        if (artifact.chainId != block.chainid) revert ChainIdMismatch(artifact.chainId, block.chainid);
        if (artifact.chainId == 1337 || artifact.chainId == 31337) {
            revert UnsupportedReleaseChainId(artifact.chainId);
        }
        _requireText(artifact.camURI, "camURI");
        if (artifact.camHash == bytes32(0)) revert ZeroValue("camHash");
        _requireText(artifact.tokenName, "tokenName");
        _requireText(artifact.tokenSymbol, "tokenSymbol");
        _requireText(artifact.baseTokenURI, "baseTokenURI");
        _requireText(artifact.collectionURI, "collectionURI");
        if (artifact.componentsAdminDelay == 0) revert ZeroValue("componentsAdminDelay");
        if (artifact.managerAdminDelay == 0) revert ZeroValue("managerAdminDelay");
        if (artifact.registrars.length == 0) revert ZeroValue("registrars");
    }

    function _verifyCode(Artifact memory artifact) private view {
        _requireCode("camRoot", artifact.camRoot, artifact.camRootCodeHash);
        _requireCode("components", artifact.components, artifact.componentsCodeHash);
        _requireCode("manager", artifact.manager, artifact.managerCodeHash);
        _requireCode("ui", artifact.ui, artifact.uiCodeHash);
    }

    function _verifyCamRoot(Artifact memory artifact) private view {
        CamRoot root = CamRoot(artifact.camRoot);
        _requireString("camURI", artifact.camURI, root.camURI());
        if (root.camHash() != artifact.camHash) revert ValueMismatch("camHash");
        _requireAddress("camRootOwner", artifact.camRootOwner, root.owner());
        address pendingOwner = root.pendingOwner();
        if (pendingOwner != address(0)) revert PendingAuthority("camRootOwner", pendingOwner);
        _requireAddress("BicycleComponentManager binding", artifact.manager, root.contractAddress(CAM_CONTRACT_MANAGER));
        _requireAddress("BicycleComponentManagerUI binding", artifact.ui, root.contractAddress(CAM_CONTRACT_MANAGER_UI));
        _requireAddress(
            "UI manager", artifact.manager, address(BicycleComponentManagerUI(payable(artifact.ui)).manager())
        );
    }

    function _verifyComponents(Artifact memory artifact) private view {
        BicycleComponents components = BicycleComponents(artifact.components);
        _requireString("tokenName", artifact.tokenName, components.name());
        _requireString("tokenSymbol", artifact.tokenSymbol, components.symbol());
        _requireString("baseTokenURI", artifact.baseTokenURI, components.baseURI());
        _requireString("collectionURI", artifact.collectionURI, components.contractURI());
        if (components.paused()) revert ValueMismatch("components paused");
        _requireAddress("componentsAdmin", artifact.componentsAdmin, components.defaultAdmin());
        (address pendingAdmin,) = components.pendingDefaultAdmin();
        if (pendingAdmin != address(0)) revert PendingAuthority("componentsAdmin", pendingAdmin);
        uint48 delay = components.defaultAdminDelay();
        if (delay != artifact.componentsAdminDelay) {
            revert DelayMismatch("componentsAdminDelay", artifact.componentsAdminDelay, delay);
        }
        (uint48 pendingDelay, uint48 pendingDelaySchedule) = components.pendingDefaultAdminDelay();
        if (pendingDelay != 0 || pendingDelaySchedule != 0) {
            revert PendingAdminDelay("componentsAdminDelay", pendingDelay, pendingDelaySchedule);
        }
        _requireRole("components manager minter", components, components.MINTER_ROLE(), artifact.manager, true);
        _requireRole(
            "components manager URI setter", components, components.TOKEN_URI_SETTER_ROLE(), artifact.manager, true
        );
        _requireRole("components pauser", components, components.PAUSER_ROLE(), artifact.componentsPauser, true);
        _requireRole(
            "components configurer", components, components.CONFIGURER_ROLE(), artifact.componentsConfigurer, true
        );
        _requireRole("deployer components admin", components, bytes32(0), artifact.deployer, false);
        _requireRole("deployer components pauser", components, components.PAUSER_ROLE(), artifact.deployer, false);
        _requireRole(
            "deployer components configurer", components, components.CONFIGURER_ROLE(), artifact.deployer, false
        );
        _requireRole("deployer components minter", components, components.MINTER_ROLE(), artifact.deployer, false);
        _requireRole(
            "deployer components URI setter", components, components.TOKEN_URI_SETTER_ROLE(), artifact.deployer, false
        );
    }

    function _verifyManager(Artifact memory artifact) private view {
        BicycleComponentManager manager = BicycleComponentManager(payable(artifact.manager));
        _requireAddress("manager components", artifact.components, manager.componentsAddress());
        if (manager.paused()) revert ValueMismatch("manager paused");
        _requireAddress("managerAdmin", artifact.managerAdmin, manager.defaultAdmin());
        (address pendingAdmin,) = manager.pendingDefaultAdmin();
        if (pendingAdmin != address(0)) revert PendingAuthority("managerAdmin", pendingAdmin);
        uint48 delay = manager.defaultAdminDelay();
        if (delay != artifact.managerAdminDelay) {
            revert DelayMismatch("managerAdminDelay", artifact.managerAdminDelay, delay);
        }
        (uint48 pendingDelay, uint48 pendingDelaySchedule) = manager.pendingDefaultAdminDelay();
        if (pendingDelay != 0 || pendingDelaySchedule != 0) {
            revert PendingAdminDelay("managerAdminDelay", pendingDelay, pendingDelaySchedule);
        }
        if (manager.maxDelegationDuration() != manager.DEFAULT_MAX_DELEGATION_DURATION()) {
            revert ValueMismatch("manager max delegation duration");
        }
        _requireRole("manager pauser", manager, manager.PAUSER_ROLE(), artifact.managerPauser, true);
        _requireRole("manager configurer", manager, manager.CONFIGURER_ROLE(), artifact.managerConfigurer, true);
        for (uint256 i = 0; i < artifact.registrars.length; i++) {
            _requireRole("manager registrar", manager, manager.REGISTRAR_ROLE(), artifact.registrars[i], true);
        }
        _requireRole("deployer manager admin", manager, bytes32(0), artifact.deployer, false);
        _requireRole("deployer manager pauser", manager, manager.PAUSER_ROLE(), artifact.deployer, false);
        _requireRole("deployer manager configurer", manager, manager.CONFIGURER_ROLE(), artifact.deployer, false);
        _requireRole("deployer manager registrar", manager, manager.REGISTRAR_ROLE(), artifact.deployer, false);
    }

    function _verifyInterfaces(Artifact memory artifact) private view {
        _requireInterface("CamRoot ICamApp", artifact.camRoot, type(ICamApp).interfaceId);
        _requireInterface("CamRoot IERC165", artifact.camRoot, type(IERC165).interfaceId);
        _requireInterface("components IBicycleComponents", artifact.components, type(IBicycleComponents).interfaceId);
        _requireInterface("components IERC721Metadata", artifact.components, type(IERC721Metadata).interfaceId);
        _requireInterface(
            "components admin rules", artifact.components, type(IAccessControlDefaultAdminRules).interfaceId
        );
        _requireInterface("manager view", artifact.manager, type(IBicycleComponentManagerView).interfaceId);
        _requireInterface("manager admin rules", artifact.manager, type(IAccessControlDefaultAdminRules).interfaceId);
    }

    function _verifySourceCode(Artifact memory artifact) private {
        CamRoot root = new CamRoot(artifact.camRootOwner, artifact.camURI, artifact.camHash);
        _requireHash("source CamRoot", address(root).codehash, artifact.camRoot.codehash);
        BicycleComponents components = new BicycleComponents(
            artifact.tokenName,
            artifact.tokenSymbol,
            artifact.componentsAdmin,
            artifact.componentsAdminDelay,
            artifact.baseTokenURI,
            artifact.collectionURI
        );
        _requireHash("source BicycleComponents", address(components).codehash, artifact.components.codehash);
        BicycleComponentManager manager =
            new BicycleComponentManager(artifact.managerAdmin, artifact.managerAdminDelay, address(components));
        _requireHash("source BicycleComponentManager", address(manager).codehash, artifact.manager.codehash);
        BicycleComponentManagerUI ui = new BicycleComponentManagerUI(artifact.manager);
        _requireHash("source BicycleComponentManagerUI", address(ui).codehash, artifact.ui.codehash);
    }

    function _requireRole(string memory field, BicycleComponents target, bytes32 role, address account, bool expected)
        private
        view
    {
        if (target.hasRole(role, account) != expected) revert RoleMismatch(field, role, account, expected);
    }

    function _requireRole(
        string memory field,
        BicycleComponentManager target,
        bytes32 role,
        address account,
        bool expected
    ) private view {
        if (target.hasRole(role, account) != expected) {
            revert RoleMismatch(field, role, account, expected);
        }
    }

    function _requireCode(string memory field, address target, bytes32 artifactHash) private view {
        if (target == address(0) || target.code.length == 0) revert MissingCode(field, target);
        _requireHash(field, artifactHash, target.codehash);
    }

    function _requireHash(string memory field, bytes32 expected, bytes32 actual) private pure {
        if (expected != actual) revert CodeHashMismatch(field, expected, actual);
    }

    function _requireText(string memory value, string memory field) private pure {
        if (bytes(value).length == 0) revert EmptyValue(field);
    }

    function _requireString(string memory field, string memory expected, string memory actual) private pure {
        if (keccak256(bytes(expected)) != keccak256(bytes(actual))) revert ValueMismatch(field);
    }

    function _requireAddress(string memory field, address expected, address actual) private pure {
        if (expected == address(0) || expected != actual) revert AddressMismatch(field, expected, actual);
    }

    function _requireInterface(string memory field, address target, bytes4 interfaceId) private view {
        bool supported;
        try IERC165(target).supportsInterface(interfaceId) returns (bool result) {
            supported = result;
        } catch {}
        if (!supported) revert UnsupportedInterface(field, interfaceId);
    }
}
