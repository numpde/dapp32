pragma solidity 0.8.35;

import {IERC721Receiver} from "@openzeppelin-contracts-5.6.1/token/ERC721/IERC721Receiver.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";
import {BicycleComponentManagerTestSupport} from "../../support/BicycleComponentManagerTestSupport.sol";

/// @dev No generation getter is prescribed: generation is an implementation
/// choice, while permanent invalidation is observable through existing reads
/// and attempted registry writes. Each transfer path must satisfy the same law.
contract BicycleOwnershipGenerationRoadmapTest is BicycleComponentManagerTestSupport {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    address private constant OWNER = address(0x2001);
    address private constant BUYER = address(0x2002);
    address private constant REGISTRAR = address(0x1001);
    address private constant DELEGATE = address(0x3001);
    address private constant OPERATOR = address(0x4001);
    string private constant SERIAL = "OWNERSHIP-ROADMAP-001";
    string private constant SECOND_SERIAL = "OWNERSHIP-ROADMAP-002";
    uint64 private constant CAPABILITIES = 7;

    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", address(this), 0, "", "");
        manager = new BicycleComponentManager(address(this), 0, address(components));
        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));
        manager.grantRole(manager.REGISTRAR_ROLE(), REGISTRAR);
        vm.startPrank(REGISTRAR);
        manager.registerComponent(OWNER, SERIAL, "fixture://components/original.json");
        manager.registerComponent(OWNER, SECOND_SERIAL, "fixture://components/second.json");
        vm.stopPrank();
        grant(SERIAL, DELEGATE);
        grant(SECOND_SERIAL, DELEGATE);
    }

    function test_directTransferPermanentlyInvalidatesGrantAfterRoundTrip() external {
        roundTrip(0);
    }

    function test_safeTransferWithoutDataPermanentlyInvalidatesGrantAfterRoundTrip() external {
        roundTrip(1);
    }

    function test_safeTransferWithDataPermanentlyInvalidatesGrantAfterRoundTrip() external {
        roundTrip(2);
    }

    function test_tokenApprovedTransferPermanentlyInvalidatesGrantAfterRoundTrip() external {
        roundTrip(3);
    }

    function test_approvedForAllTransferPermanentlyInvalidatesGrantAfterRoundTrip() external {
        roundTrip(4);
    }

    function test_newGrantAfterReturnWorksButOtherDelegateStaysInvalid() external {
        address secondDelegate = address(0x3002);
        grant(SERIAL, secondDelegate);
        transfer(OWNER, BUYER, 0);
        transfer(BUYER, OWNER, 0);
        assertInvalid(DELEGATE);
        grant(SERIAL, DELEGATE);
        assertEq(manager.permissionsOf(DELEGATE, SERIAL), CAPABILITIES, "explicit fresh grant must work");
        vm.prank(DELEGATE);
        manager.setComponentMetadata(SERIAL, "fixture://components/fresh-grant.json");
        assertEq(manager.componentURI(SERIAL), "fixture://components/fresh-grant.json", "fresh grant permits write");
        assertInvalid(secondDelegate);
    }

    function test_returnToGrantorDoesNotReviveReportResolutionPower() external {
        vm.prank(OWNER);
        manager.markComponentMissing(SERIAL, "fixture://reports/open.json");
        transfer(OWNER, BUYER, 0);
        transfer(BUYER, OWNER, 0);
        assertFalse(manager.canClearMissing(DELEGATE, SERIAL), "return must not revive resolution capability");
        vm.prank(DELEGATE);
        vm.expectRevert(abi.encodeWithSelector(
            BicycleComponentManager.Unauthorized.selector, DELEGATE, keccak256(bytes(SERIAL)), uint64(4)
        ));
        manager.clearComponentMissing(SERIAL, "fixture://reports/stale-resolution.json");
        assertTrue(manager.missingStatus(SERIAL), "stale delegate cannot close open report");
    }

    function testFuzz_selfTransfersPreserveDelegation(uint8 pathSeed) external {
        uint8 path = uint8(bound(pathSeed, 0, 4));
        transfer(OWNER, OWNER, path);
        assertEq(manager.permissionsOf(DELEGATE, SERIAL), CAPABILITIES, "self-transfer is not an ownership change");
        (,,, bool active) = manager.componentDelegation(SERIAL, DELEGATE);
        assertTrue(active, "self-transfer must preserve grant activity");
        vm.prank(DELEGATE);
        manager.setComponentMetadata(SERIAL, "fixture://components/self-transfer.json");
    }

    function test_rejectedReceiverTransferRollsBackGrantInvalidation() external {
        RejectOwnershipReceiver rejecting = new RejectOwnershipReceiver();
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        (bool ok,) = address(components).call(
            abi.encodeWithSignature("safeTransferFrom(address,address,uint256)", OWNER, address(rejecting), tokenId)
        );
        assertFalse(ok, "receiver must reject safe transfer fixture");
        assertEq(manager.ownerOf(SERIAL), OWNER, "failed transfer must preserve owner");
        assertEq(manager.permissionsOf(DELEGATE, SERIAL), CAPABILITIES, "reverted transfer must preserve grant");
        vm.prank(DELEGATE);
        manager.setComponentMetadata(SERIAL, "fixture://components/after-rejection.json");
    }

    function test_unauthorizedTransferDoesNotInvalidateGrant() external {
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OPERATOR);
        (bool ok,) = address(components).call(abi.encodeWithSignature("transferFrom(address,address,uint256)", OWNER, BUYER, tokenId));
        assertFalse(ok, "unapproved transfer must fail");
        assertEq(manager.ownerOf(SERIAL), OWNER, "failed authorization preserves owner");
        assertEq(manager.permissionsOf(DELEGATE, SERIAL), CAPABILITIES, "failed authorization preserves delegation");
    }

    function test_safeReceiverCannotUseRevivedGrantDuringReturnCallback() external {
        ReturnAndUseStaleGrant receiver = new ReturnAndUseStaleGrant(components, manager, OWNER, SERIAL);
        grant(SERIAL, address(receiver));
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        components.safeTransferFrom(OWNER, address(receiver), tokenId, hex"1234");
        assertTrue(receiver.callbackReached(), "test must exercise ERC721 receiver callback");
        assertEq(manager.ownerOf(SERIAL), OWNER, "receiver fixture must return token during callback");
        assertFalse(receiver.staleWriteSucceeded(), "ownership change must invalidate grant before receiver callback");
        assertEq(manager.componentURI(SERIAL), "fixture://components/original.json", "callback must not mutate metadata");
        assertInvalid(address(receiver));
    }

    /// @dev Bounded state-machine property: arbitrary transfer entrypoints and
    /// repeated returns never revive the original grant. No expiry is needed.
    function testFuzz_roundTripsNeverReviveOriginalGrant(uint8 countSeed, uint256 paths) external {
        uint256 count = bound(countSeed, 1, 12);
        for (uint256 i; i < count; i++) {
            transfer(OWNER, BUYER, uint8((paths >> (i * 5)) % 5));
            assertInvalid(DELEGATE);
            transfer(BUYER, OWNER, uint8((paths >> (i * 5 + 2)) % 5));
            assertInvalid(DELEGATE);
            assertEq(manager.permissionsOf(DELEGATE, SECOND_SERIAL), CAPABILITIES, "other token grant is independent");
        }
    }

    function roundTrip(uint8 path) private {
        transfer(OWNER, BUYER, path);
        assertInvalid(DELEGATE);
        assertEq(manager.permissionsOf(DELEGATE, SECOND_SERIAL), CAPABILITIES, "selling one token must not revoke another");
        transfer(BUYER, OWNER, path);
        assertEq(manager.ownerOf(SERIAL), OWNER, "round trip returns ownership to original grantor");
        assertInvalid(DELEGATE);
    }

    function assertInvalid(address actor) private {
        assertEq(manager.permissionsOf(actor, SERIAL), 0, "ownership change permanently invalidates old grants");
        (,,, bool active) = manager.componentDelegation(SERIAL, actor);
        assertFalse(active, "delegation read must not revive on return to grantor");
        assertFalse(manager.canUpdateMetadata(actor, SERIAL), "stale delegate must not be offered metadata writes");
        assertFalse(manager.canMarkMissing(actor, SERIAL), "stale delegate must not be offered report writes");
        vm.prank(actor);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, actor, keccak256(bytes(SERIAL)), uint64(1)));
        manager.setComponentMetadata(SERIAL, "fixture://components/stale.json");
        vm.prank(actor);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, actor, keccak256(bytes(SERIAL)), uint64(2)));
        manager.markComponentMissing(SERIAL, "fixture://reports/stale.json");
    }

    function grant(string memory serial, address delegate) private {
        vm.prank(OWNER);
        manager.setComponentDelegate(serial, delegate, CAPABILITIES, uint48(block.timestamp + 7 days));
    }

    function transfer(address from, address to, uint8 path) private {
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        if (path == 3) {
            vm.prank(from);
            components.approve(OPERATOR, tokenId);
        } else if (path == 4) {
            vm.prank(from);
            components.setApprovalForAll(OPERATOR, true);
        }
        vm.prank(path >= 3 ? OPERATOR : from);
        if (path == 1) components.safeTransferFrom(from, to, tokenId);
        else if (path == 2) components.safeTransferFrom(from, to, tokenId, hex"1234");
        else components.transferFrom(from, to, tokenId);
    }
}

contract RejectOwnershipReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert("fixture rejects ownership");
    }
}

/// @dev This receiver was granted metadata rights by the original owner. It
/// returns the NFT synchronously and attempts to exploit grantor-equality-only
/// authorization before the outer safe transfer has finished.
contract ReturnAndUseStaleGrant is IERC721Receiver {
    BicycleComponents private immutable components;
    BicycleComponentManager private immutable manager;
    address private immutable originalOwner;
    string private serial;
    bool public callbackReached;
    bool public staleWriteSucceeded;

    constructor(BicycleComponents components_, BicycleComponentManager manager_, address owner_, string memory serial_) {
        components = components_;
        manager = manager_;
        originalOwner = owner_;
        serial = serial_;
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(components), "unexpected collection");
        callbackReached = true;
        components.transferFrom(address(this), originalOwner, tokenId);
        (staleWriteSucceeded,) = address(manager).call(
            abi.encodeCall(BicycleComponentManager.setComponentMetadata, (serial, "fixture://components/stale-callback.json"))
        );
        return IERC721Receiver.onERC721Received.selector;
    }
}
