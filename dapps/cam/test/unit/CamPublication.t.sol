pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {CamRoot} from "../../src/CamRoot.sol";
import {ICamApp} from "../../src/ICamApp.sol";
import {CamPublication} from "../../script/CamPublication.sol";

contract CamPublicationHarness is CamPublication {
    function applyPublication(
        CamRoot root,
        address signer,
        BindingUpdate[] memory bindings,
        ManifestUpdate memory manifest,
        OwnerNomination memory nomination
    ) external {
        publishCam(root, signer, bindings, manifest, nomination);
    }

    function acceptRoot(CamRoot root) external {
        root.acceptOwnership();
    }

    function setBinding(CamRoot root, string memory name, address target) external {
        root.setContractAddress(name, target);
    }

    function setManifest(CamRoot root, string memory uri, bytes32 hash) external {
        root.setCam(uri, hash);
    }
}

contract CamPublicationTest is Test {
    CamPublicationHarness private publisher;
    CamRoot private root;

    function setUp() external {
        publisher = new CamPublicationHarness();
        root = new CamRoot(address(this), "ipfs://before", bytes32(uint256(1)));
        root.transferOwnership(address(publisher));
        publisher.acceptRoot(root);
    }

    function testCurrentOwnerCanPublishAfterAnIndependentCreationAndOwnershipAcceptance() external {
        publisher.applyPublication(
            root,
            address(publisher),
            _bindings(),
            _manifest(),
            CamPublication.OwnerNomination(address(0), address(0x33))
        );
        assertEq(root.owner(), address(publisher));
        assertEq(root.pendingOwner(), address(0x33));
        assertEq(root.contractAddress("CamEscrow"), address(0x11));
        assertEq(root.contractAddress("CamEscrowUI"), address(0x22));
        ICamApp.ManifestRef memory manifest = root.camManifest();
        assertEq(manifest.uri, "ipfs://after");
        assertEq(manifest.sha256Digest, bytes32(uint256(2)));
    }

    function testAlreadyDesiredFieldsNeedNoSecondWrite() external {
        publisher.setBinding(root, "CamEscrow", address(0x11));
        publisher.setManifest(root, "ipfs://after", bytes32(uint256(2)));
        vm.mockCallRevert(
            address(root),
            abi.encodeCall(CamRoot.setContractAddress, ("CamEscrow", address(0x11))),
            abi.encodeWithSignature("Error(string)", "already desired binding was written twice")
        );
        vm.mockCallRevert(
            address(root),
            abi.encodeCall(CamRoot.setCam, ("ipfs://after", bytes32(uint256(2)))),
            abi.encodeWithSignature("Error(string)", "already desired manifest was written twice")
        );
        publisher.applyPublication(
            root, address(publisher), _bindings(), _manifest(), CamPublication.OwnerNomination(address(0), address(0))
        );
        assertEq(root.contractAddress("CamEscrowUI"), address(0x22));
    }

    function testAcceptedFinalOwnerIsNotNominatedAgain() external {
        publisher.applyPublication(
            root,
            address(publisher),
            _bindings(),
            _manifest(),
            CamPublication.OwnerNomination(address(publisher), address(publisher))
        );
        assertEq(root.pendingOwner(), address(0));
    }

    function testNoHandoffPreservesAnExistingPendingOwner() external {
        vm.prank(address(publisher));
        root.transferOwnership(address(0x44));
        publisher.applyPublication(
            root,
            address(publisher),
            _bindings(),
            _manifest(),
            CamPublication.OwnerNomination(address(0x44), address(0))
        );
        assertEq(root.pendingOwner(), address(0x44));
    }

    function testKnownLaterBindingDriftFailsBeforeTheFirstWrite() external {
        publisher.setBinding(root, "CamEscrowUI", address(0x99));
        vm.mockCallRevert(
            address(root),
            abi.encodeCall(CamRoot.setContractAddress, ("CamEscrow", address(0x11))),
            abi.encodeWithSignature("Error(string)", "write started before complete preflight")
        );
        vm.expectRevert(abi.encodeWithSelector(CamPublication.CamPublicationStateDrift.selector, "CamEscrowUI"));
        publisher.applyPublication(
            root, address(publisher), _bindings(), _manifest(), CamPublication.OwnerNomination(address(0), address(0))
        );
    }

    function _bindings() private pure returns (CamPublication.BindingUpdate[] memory bindings) {
        bindings = new CamPublication.BindingUpdate[](2);
        bindings[0] = CamPublication.BindingUpdate("CamEscrow", address(0), address(0x11));
        bindings[1] = CamPublication.BindingUpdate("CamEscrowUI", address(0), address(0x22));
    }

    function _manifest() private pure returns (CamPublication.ManifestUpdate memory) {
        return CamPublication.ManifestUpdate("ipfs://before", bytes32(uint256(1)), "ipfs://after", bytes32(uint256(2)));
    }
}
