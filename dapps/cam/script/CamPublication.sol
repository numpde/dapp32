pragma solidity 0.8.35;

import {CamRoot} from "../src/CamRoot.sol";
import {ICamApp} from "../src/ICamApp.sol";

/// @notice Preflights a CAM root's complete known state, then emits only its remaining publication writes.
/// @dev Script admission is not compare-and-swap at mining: the orchestrator must reconcile actual receipts and root state.
abstract contract CamPublication {
    struct BindingUpdate {
        string name;
        address beforeAddress;
        address nextAddress;
    }

    struct ManifestUpdate {
        string beforeURI;
        bytes32 beforeHash;
        string nextURI;
        bytes32 nextHash;
    }

    /// @dev A zero intended owner leaves the existing handoff unchanged.
    struct OwnerNomination {
        address beforePendingOwner;
        address intendedOwner;
    }

    error CamPublicationOwnerMismatch(address expected, address actual);
    error CamPublicationStateDrift(string field);

    function publishCam(
        CamRoot root,
        address signer,
        BindingUpdate[] memory bindings,
        ManifestUpdate memory manifest,
        OwnerNomination memory nomination
    ) internal {
        address owner = root.owner();
        if (owner != signer) revert CamPublicationOwnerMismatch(signer, owner);
        bool[] memory changeBinding = new bool[](bindings.length);
        for (uint256 i; i < bindings.length; i++) {
            address current = root.contractAddress(bindings[i].name);
            if (current == bindings[i].nextAddress) continue;
            if (current != bindings[i].beforeAddress) revert CamPublicationStateDrift(bindings[i].name);
            changeBinding[i] = true;
        }
        ICamApp.ManifestRef memory currentManifest = root.camManifest();
        bool changeManifest = !_sameManifest(currentManifest, manifest.nextURI, manifest.nextHash);
        if (changeManifest && !_sameManifest(currentManifest, manifest.beforeURI, manifest.beforeHash)) {
            revert CamPublicationStateDrift("CAM manifest");
        }
        address pending = root.pendingOwner();
        bool changeNominee;
        if (nomination.intendedOwner == address(0)) {
            if (pending != nomination.beforePendingOwner) revert CamPublicationStateDrift("pending CAM owner");
        } else if (owner == nomination.intendedOwner) {
            if (pending != address(0) && pending != nomination.beforePendingOwner) {
                revert CamPublicationStateDrift("pending CAM owner");
            }
        } else if (pending != nomination.intendedOwner) {
            if (pending != nomination.beforePendingOwner) revert CamPublicationStateDrift("pending CAM owner");
            changeNominee = true;
        }

        for (uint256 i; i < bindings.length; i++) {
            if (changeBinding[i]) root.setContractAddress(bindings[i].name, bindings[i].nextAddress);
        }
        if (changeManifest) root.setCam(manifest.nextURI, manifest.nextHash);
        if (changeNominee) root.transferOwnership(nomination.intendedOwner);
    }

    function _sameManifest(ICamApp.ManifestRef memory current, string memory uri, bytes32 hash)
        private
        pure
        returns (bool)
    {
        return current.sha256Digest == hash && keccak256(bytes(current.uri)) == keccak256(bytes(uri));
    }
}
