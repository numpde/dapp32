pragma solidity 0.8.35;

import {Script} from "forge-std-1.12.0/src/Script.sol";
import {CamRoot} from "../src/CamRoot.sol";
import {CamPublication} from "./CamPublication.sol";

/// @notice Publishes an independently prepared CAM plan through a new or existing root.
/// @dev Plan provenance and artifact admission belong to the caller; publication preflights the selected root state.
contract PublishCam is Script, CamPublication {
    struct PublicationPlan {
        bool createRoot;
        CamRoot root;
        BindingUpdate[] bindings;
        bool[] rootReferences;
        ManifestUpdate manifest;
        OwnerNomination nomination;
    }

    error InvalidCamPublicationPlan(string field);

    function run() external returns (CamRoot root) {
        string memory json = vm.readFile(vm.envString("CAM_PUBLICATION_PLAN_PATH"));
        return _publishPlan(json, vm.envUint("PRIVATE_KEY"));
    }

    function _publishPlan(string memory json, uint256 key) internal returns (CamRoot root) {
        address signer = vm.addr(key);
        PublicationPlan memory plan = _parsePlan(json, signer);
        vm.startBroadcast(key);
        root = plan.root;
        if (plan.createRoot) root = new CamRoot(signer, plan.manifest.nextURI, plan.manifest.nextHash);
        for (uint256 i; i < plan.bindings.length; i++) {
            if (plan.rootReferences[i]) plan.bindings[i].nextAddress = address(root);
        }
        publishCam(root, signer, plan.bindings, plan.manifest, plan.nomination);
        vm.stopBroadcast();
    }

    function _parsePlan(string memory json, address signer) private view returns (PublicationPlan memory plan) {
        if (!_same(vm.parseJsonString(json, ".schema"), "cam.publication-plan.v1")) {
            revert InvalidCamPublicationPlan("schema");
        }
        if (vm.parseJsonUint(json, ".expectedChainId") != block.chainid) {
            revert InvalidCamPublicationPlan("expectedChainId");
        }
        string memory kind = vm.parseJsonString(json, ".root.kind");
        if (_same(kind, "new")) {
            plan.createRoot = true;
        } else if (_same(kind, "existing")) {
            plan.root = CamRoot(vm.parseJsonAddress(json, ".root.contract.address"));
            if (vm.parseJsonAddress(json, ".root.owner") != signer) {
                revert InvalidCamPublicationPlan("root.owner differs from signer");
            }
            plan.nomination.beforePendingOwner = vm.parseJsonAddress(json, ".root.pendingOwner");
        } else {
            revert InvalidCamPublicationPlan("root.kind must be new or existing");
        }

        plan.manifest.nextURI = vm.parseJsonString(json, ".manifest.uri");
        plan.manifest.nextHash = vm.parseJsonBytes32(json, ".manifest.hash");
        plan.manifest.beforeURI =
            plan.createRoot ? plan.manifest.nextURI : vm.parseJsonString(json, ".root.manifest.uri");
        plan.manifest.beforeHash =
            plan.createRoot ? plan.manifest.nextHash : vm.parseJsonBytes32(json, ".root.manifest.hash");
        string memory nomination = vm.parseJsonString(json, ".nomination");
        if (keccak256(bytes(nomination)) == keccak256("nominate")) {
            plan.nomination.intendedOwner = vm.parseJsonAddress(json, ".intendedOwner");
        } else if (keccak256(bytes(nomination)) != keccak256("preserve")) {
            revert InvalidCamPublicationPlan("nomination intent");
        }

        if (!vm.keyExistsJson(json, ".bindings")) revert InvalidCamPublicationPlan("bindings");
        uint256 length;
        while (vm.keyExistsJson(json, string.concat(".bindings[", vm.toString(length), "]"))) length++;
        plan.bindings = new BindingUpdate[](length);
        plan.rootReferences = new bool[](length);
        for (uint256 i; i < length; i++) {
            string memory path = string.concat(".bindings[", vm.toString(i), "]");
            string memory name = vm.parseJsonString(json, string.concat(path, ".name"));
            address next;
            if (vm.keyExistsJson(json, string.concat(path, ".address.createdContract"))) {
                if (
                    !plan.createRoot
                        || !_same(vm.parseJsonString(json, string.concat(path, ".address.createdContract")), "camRoot")
                ) {
                    revert InvalidCamPublicationPlan("binding createdContract must select the new camRoot");
                }
                plan.rootReferences[i] = true;
            } else {
                next = vm.parseJsonAddress(json, string.concat(path, ".address"));
            }
            address beforeAddress =
                plan.createRoot ? address(0) : vm.parseJsonAddress(json, string.concat(".root.bindings.", name));
            plan.bindings[i] = BindingUpdate(name, beforeAddress, next);
        }
    }

    function _same(string memory left, string memory right) private pure returns (bool) {
        return keccak256(bytes(left)) == keccak256(bytes(right));
    }
}
