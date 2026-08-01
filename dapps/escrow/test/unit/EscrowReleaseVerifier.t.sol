pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {CamRoot} from "cam/src/CamRoot.sol";

import {CamEscrow} from "../../src/CamEscrow.sol";
import {CamEscrowUI} from "../../src/CamEscrowUI.sol";
import {EscrowReleaseVerifier} from "../../script/EscrowReleaseVerifier.sol";

contract EscrowReleaseVerifierHarness is EscrowReleaseVerifier {
    function verify(Artifact memory artifact, string memory expectedSourceCommit) external {
        verifyArtifact(artifact, expectedSourceCommit);
    }
}

contract EscrowReleaseVerifierTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/escrow/cam/main.json";
    bytes32 private constant CAM_HASH = keccak256("escrow-cam");
    uint256 private constant RELEASE_CHAIN_ID = 11_155_111;

    address private finalOwner = address(0xBEEF);
    EscrowReleaseVerifierHarness private verifier;

    function setUp() external {
        vm.chainId(RELEASE_CHAIN_ID);
        verifier = new EscrowReleaseVerifierHarness();
    }

    function testAcceptsExactDeployedReleaseAfterOwnershipAcceptance() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();

        verifier.verify(_artifact(root, escrow, ui, finalOwner), SOURCE_COMMIT);
    }

    function testRejectsSourceCommitMismatch() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();

        vm.expectRevert(
            abi.encodeWithSelector(
                EscrowReleaseVerifier.SourceCommitMismatch.selector,
                "ffffffffffffffffffffffffffffffffffffffff",
                SOURCE_COMMIT
            )
        );
        verifier.verify(
            _artifact(root, escrow, ui, finalOwner), "ffffffffffffffffffffffffffffffffffffffff"
        );
    }

    function testRejectsFixtureChain() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();
        vm.chainId(31_337);
        EscrowReleaseVerifier.Artifact memory artifact = _artifact(root, escrow, ui, finalOwner);

        vm.expectRevert(
            abi.encodeWithSelector(EscrowReleaseVerifier.UnsupportedReleaseChainId.selector, 31_337)
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testRejectsZeroCamHash() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();
        EscrowReleaseVerifier.Artifact memory artifact = _artifact(root, escrow, ui, finalOwner);
        artifact.camHash = bytes32(0);

        vm.expectRevert(EscrowReleaseVerifier.ZeroCamHash.selector);
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testRejectsEmptyCamURI() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();
        EscrowReleaseVerifier.Artifact memory artifact = _artifact(root, escrow, ui, finalOwner);
        artifact.camURI = "";

        vm.expectRevert(EscrowReleaseVerifier.EmptyCamURI.selector);
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function testRejectsPendingOwnershipEvenWhenCurrentOwnerMatchesArtifact() external {
        CamRoot root = new CamRoot(address(this), CAM_URI, CAM_HASH);
        CamEscrow escrow = new CamEscrow();
        CamEscrowUI ui = new CamEscrowUI(address(escrow));
        _bind(root, escrow, ui);
        root.transferOwnership(finalOwner);

        vm.expectRevert(
            abi.encodeWithSelector(EscrowReleaseVerifier.CamRootOwnershipPending.selector, finalOwner)
        );
        verifier.verify(_artifact(root, escrow, ui, address(this)), SOURCE_COMMIT);
    }

    function testRejectsRootBindingDrift() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();

        vm.prank(finalOwner);
        root.setContractAddress("CamEscrowUI", address(0xCAFE));

        vm.expectRevert(
            abi.encodeWithSelector(
                EscrowReleaseVerifier.ContractBindingMismatch.selector,
                "CamEscrowUI",
                address(ui),
                address(0xCAFE)
            )
        );
        verifier.verify(_artifact(root, escrow, ui, finalOwner), SOURCE_COMMIT);
    }

    function testRejectsArtifactCodeHashDrift() external {
        (CamRoot root, CamEscrow escrow, CamEscrowUI ui) = _deployAcceptedRelease();
        EscrowReleaseVerifier.Artifact memory artifact = _artifact(root, escrow, ui, finalOwner);
        artifact.camEscrowCodeHash = bytes32(uint256(1));

        vm.expectRevert(
            abi.encodeWithSelector(
                EscrowReleaseVerifier.CodeHashMismatch.selector,
                "artifact CamEscrow",
                bytes32(uint256(1)),
                address(escrow).codehash
            )
        );
        verifier.verify(artifact, SOURCE_COMMIT);
    }

    function _deployAcceptedRelease() private returns (CamRoot root, CamEscrow escrow, CamEscrowUI ui) {
        root = new CamRoot(address(this), CAM_URI, CAM_HASH);
        escrow = new CamEscrow();
        ui = new CamEscrowUI(address(escrow));
        _bind(root, escrow, ui);

        root.transferOwnership(finalOwner);
        vm.prank(finalOwner);
        root.acceptOwnership();
    }

    function _bind(CamRoot root, CamEscrow escrow, CamEscrowUI ui) private {
        root.setContractAddress("CamEscrow", address(escrow));
        root.setContractAddress("CamEscrowUI", address(ui));
    }

    function _artifact(CamRoot root, CamEscrow escrow, CamEscrowUI ui, address intendedOwner)
        private
        view
        returns (EscrowReleaseVerifier.Artifact memory artifact)
    {
        artifact.sourceCommit = SOURCE_COMMIT;
        artifact.chainId = block.chainid;
        artifact.camURI = CAM_URI;
        artifact.camHash = CAM_HASH;
        artifact.intendedCamRootOwner = intendedOwner;
        artifact.camRoot = address(root);
        artifact.camEscrow = address(escrow);
        artifact.camEscrowUI = address(ui);
        artifact.camRootCodeHash = address(root).codehash;
        artifact.camEscrowCodeHash = address(escrow).codehash;
        artifact.camEscrowUICodeHash = address(ui).codehash;
    }
}
