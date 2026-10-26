pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {PublishCam} from "../../script/PublishCam.s.sol";
import {CamPublication} from "../../script/CamPublication.sol";
import {CamRoot} from "../../src/CamRoot.sol";
import {ICamApp} from "../../src/ICamApp.sol";

contract PublishCamHarness is PublishCam {
    function publishJSON(string memory json, uint256 key) external returns (CamRoot) {
        return _publishPlan(json, key);
    }
}

contract PublishCamTest is Test {
    // Repeated-pattern private key is useful only for these local fixtures.
    uint256 private constant KEY = 0xbabababababababababababababababababababababababababababababababa;
    PublishCamHarness private publisher;
    address private signer;

    function setUp() external {
        publisher = new PublishCamHarness();
        signer = vm.addr(KEY);
    }

    function testNewRootUsesOrderedConcreteBindingsAndExplicitSelfReference() external {
        CamRoot root = publisher.publishJSON(
            _plan(
                '{"kind":"new"}',
                '[{"name":"Business","address":"0x0000000000000000000000000000000000000011"},'
                '{"name":"ICamRootOwnership","address":{"createdContract":"camRoot"}}]'
            ),
            KEY
        );
        assertEq(root.owner(), signer);
        assertEq(root.pendingOwner(), address(0x33));
        assertEq(root.contractAddress("Business"), address(0x11));
        assertEq(root.contractAddress("ICamRootOwnership"), address(root));
        ICamApp.ManifestRef memory manifest = root.camManifest();
        assertEq(manifest.uri, "ipfs://desired");
        assertEq(manifest.sha256Digest, bytes32(uint256(2)));
    }

    function testExistingRootUsesPlannedBaselineAndNomination() external {
        CamRoot root = new CamRoot(signer, "ipfs://before", bytes32(uint256(1)));
        vm.prank(signer);
        root.setContractAddress("Business", address(0x44));
        vm.prank(signer);
        root.transferOwnership(address(0x55));
        CamRoot selected = publisher.publishJSON(_plan(_existing(root, signer), _concreteBinding()), KEY);
        assertEq(address(selected), address(root));
        assertEq(root.contractAddress("Business"), address(0x11));
        assertEq(root.pendingOwner(), address(0x33));
        ICamApp.ManifestRef memory manifest = root.camManifest();
        assertEq(manifest.uri, "ipfs://desired");
        assertEq(manifest.sha256Digest, bytes32(uint256(2)));
    }

    function testExistingManifestDriftIsPreflightedBeforeTheFirstBindingWrite() external {
        CamRoot root = new CamRoot(signer, "ipfs://drifted", bytes32(uint256(1)));
        vm.prank(signer);
        root.setContractAddress("Business", address(0x44));
        vm.mockCallRevert(
            address(root),
            abi.encodeCall(CamRoot.setContractAddress, ("Business", address(0x11))),
            abi.encodeWithSignature("Error(string)", "write started before baseline preflight")
        );
        vm.expectRevert(abi.encodeWithSelector(CamPublication.CamPublicationStateDrift.selector, "CAM manifest"));
        publisher.publishJSON(_plan(_existing(root, signer), _concreteBinding()), KEY);
    }

    function testSignerMustMatchTheOwnerInTheExistingPlan() external {
        CamRoot root = new CamRoot(signer, "ipfs://before", bytes32(uint256(1)));
        vm.expectRevert(
            abi.encodeWithSelector(PublishCam.InvalidCamPublicationPlan.selector, "root.owner differs from signer")
        );
        publisher.publishJSON(_plan(_existing(root, address(0x99)), _concreteBinding()), KEY);
    }

    function testRootSelectionAndCreatedReferenceAreExplicit() external {
        vm.expectRevert(
            abi.encodeWithSelector(PublishCam.InvalidCamPublicationPlan.selector, "root.kind must be new or existing")
        );
        publisher.publishJSON(_plan('{"kind":"implicit"}', "[]"), KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                PublishCam.InvalidCamPublicationPlan.selector, "binding createdContract must select the new camRoot"
            )
        );
        publisher.publishJSON(_plan('{"kind":"new"}', '[{"name":"Root","address":{"createdContract":"other"}}]'), KEY);
    }

    function testExpectedChainIsCheckedBeforeCreation() external {
        string memory json = _plan('{"kind":"new"}', _concreteBinding());
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(PublishCam.InvalidCamPublicationPlan.selector, "expectedChainId"));
        publisher.publishJSON(json, KEY);
    }

    function testExplicitPreserveModeDoesNotNominateTheRawRequestedOwner() external {
        CamRoot root = new CamRoot(signer, "ipfs://before", bytes32(uint256(1)));
        vm.startPrank(signer);
        root.setContractAddress("Business", address(0x44));
        root.transferOwnership(address(0x55));
        vm.stopPrank();
        publisher.publishJSON(_plan(_existing(root, signer), _concreteBinding(), "preserve"), KEY);
        assertEq(root.pendingOwner(), address(0x55));
        assertEq(root.contractAddress("Business"), address(0x11));
    }

    function _plan(string memory root, string memory bindings) private view returns (string memory) {
        return _plan(root, bindings, "nominate");
    }

    function _plan(string memory root, string memory bindings, string memory nomination)
        private
        view
        returns (string memory)
    {
        string memory metadata = string.concat(
            '{"schema":"cam.publication-plan.v1","app":"escrow","sourceCommit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",',
            '"businessArtifactSha256":"',
            vm.toString(bytes32(uint256(3))),
            '",',
            '"uiArtifactSha256":"',
            vm.toString(bytes32(uint256(4))),
            '",',
            '"bundleArtifactSha256":"',
            vm.toString(bytes32(uint256(5))),
            '",'
        );
        return string.concat(
            metadata,
            '"expectedChainId":',
            vm.toString(block.chainid),
            ',"root":',
            root,
            ',"bindings":',
            bindings,
            ',"manifest":{"uri":"ipfs://desired","hash":"',
            vm.toString(bytes32(uint256(2))),
            '"},',
            '"nomination":"',
            nomination,
            '","intendedOwner":"0x0000000000000000000000000000000000000033"}'
        );
    }

    function _existing(CamRoot root, address owner) private view returns (string memory) {
        return string.concat(
            '{"kind":"existing","contract":{"address":"',
            vm.toString(address(root)),
            '"},"owner":"',
            vm.toString(owner),
            '","pendingOwner":"0x0000000000000000000000000000000000000055",',
            '"bindings":{"Business":"0x0000000000000000000000000000000000000044"},',
            '"manifest":{"uri":"ipfs://before","hash":"',
            vm.toString(bytes32(uint256(1))),
            '"}}'
        );
    }

    function _concreteBinding() private pure returns (string memory) {
        return '[{"name":"Business","address":"0x0000000000000000000000000000000000000011"}]';
    }
}
