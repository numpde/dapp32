pragma solidity 0.8.35;

import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";
import {BicycleComponentManagerTestSupport} from "../../support/BicycleComponentManagerTestSupport.sol";

/// @dev Proposed minimal lifecycle surface: one independent inactive flag, two
/// owner-only transitions. Existing missingStatus/report URI remain report facts.
/// Keep this test-only interface until implementation; missing selectors must
/// fail explicit assertions, not compilation or incidental ABI decoding.
interface IBicycleLifecycleRoadmap {
    function inactiveStatus(string calldata serialNumber) external view returns (bool);
    function decommissionComponent(string calldata serialNumber) external;
    function reactivateComponent(string calldata serialNumber) external;
}

contract BicycleLifecycleRoadmapTest is BicycleComponentManagerTestSupport {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    address private constant OWNER = address(0x2001);
    address private constant BUYER = address(0x2002);
    address private constant REGISTRAR = address(0x1001);
    address private constant DELEGATE = address(0x3001);
    address private constant OPERATOR = address(0x4001);
    string private constant SERIAL = "LIFECYCLE-ROADMAP-001";
    string private constant REPORT = "fixture://reports/missing.json";
    string private constant RESOLUTION = "fixture://reports/found.json";
    uint64 private constant LEGACY_RETIRE_BIT = 8;
    uint64 private constant REGISTRY_CAPABILITIES = 7;

    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", address(this), 0, "", "");
        manager = new BicycleComponentManager(address(this), 0, address(components));
        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));
        manager.grantRole(manager.REGISTRAR_ROLE(), REGISTRAR);
        vm.prank(REGISTRAR);
        manager.registerComponent(OWNER, SERIAL, "fixture://components/original.json");
    }

    function test_registrationStartsActiveWithoutAMissingReport() external view {
        assertFalse(inactive(), "registration must start in active lifecycle");
        assertFalse(manager.missingStatus(SERIAL), "registration must not create a missing report");
    }

    function test_retirementCapabilityIsNotAdvertised() external view {
        assertEq(manager.VALID_CAPABILITY_MASK(), REGISTRY_CAPABILITIES, "only metadata/report bits remain");
        assertEq(manager.permissionsOf(OWNER, SERIAL), REGISTRY_CAPABILITIES, "owner mask must not advertise bit 8");
    }

    function testFuzz_legacyRetirementBitIsRejectedEvenInMixedMasks(uint8 otherBits) external {
        uint64 mask = uint64(otherBits & 7) | LEGACY_RETIRE_BIT;
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.InvalidCapabilityMask.selector, mask));
        manager.setComponentDelegate(SERIAL, DELEGATE, mask, uint48(block.timestamp + 1 days));
    }

    function test_legacyRetireWriteIsRemoved() external {
        vm.prank(OWNER);
        (bool ok,) = address(manager).call(abi.encodeWithSignature("retireComponent(string)", SERIAL));
        assertFalse(ok, "legacy irreversible retire entrypoint must no longer mutate a component");
    }

    function test_ownerCanDecommissionAndReactivateRepeatedly() external {
        for (uint256 i; i < 3; i++) {
            transition(OWNER, true);
            assertTrue(inactive(), "decommission must persist inactive state");
            assertFalse(manager.missingStatus(SERIAL), "decommission must not create a report");
            transition(OWNER, false);
            assertFalse(inactive(), "reactivation must restore active state");
        }
    }

    function test_lifecycleTransitionsPreserveOpenReportUntilExplicitResolution() external {
        vm.prank(OWNER);
        manager.markComponentMissing(SERIAL, REPORT);
        transition(OWNER, true);
        assertOpenReport();
        transition(OWNER, false);
        assertOpenReport();
        transition(OWNER, true);
        vm.prank(OWNER);
        manager.clearComponentMissing(SERIAL, RESOLUTION);
        assertTrue(inactive(), "resolving a missing report must not reactivate the component");
        assertFalse(manager.missingStatus(SERIAL), "resolution must close the report");
        assertEq(manager.componentBySerial(SERIAL).missingReportURI, "", "resolution clears open report URI");
    }

    function test_inactiveComponentCanBeReportedAndResolvedByAuthorizedDelegate() external {
        vm.prank(OWNER);
        manager.setComponentDelegate(SERIAL, DELEGATE, REGISTRY_CAPABILITIES, uint48(block.timestamp + 1 days));
        transition(OWNER, true);
        vm.prank(DELEGATE);
        manager.markComponentMissing(SERIAL, REPORT);
        assertOpenReport();
        assertTrue(inactive(), "reporting must preserve inactive lifecycle");
        vm.prank(DELEGATE);
        manager.clearComponentMissing(SERIAL, RESOLUTION);
        assertTrue(inactive(), "delegated resolution must not reactivate");
        assertFalse(manager.missingStatus(SERIAL), "delegated resolution must close report");
    }

    function testFuzz_metadataAndTransfersRemainAvailableInEitherLifecycle(bool decommissioned, bool missing) external {
        if (decommissioned) transition(OWNER, true);
        if (missing) {
            vm.prank(OWNER);
            manager.markComponentMissing(SERIAL, REPORT);
        }
        vm.prank(OWNER);
        manager.setComponentMetadata(SERIAL, "fixture://components/updated.json");
        assertEq(manager.componentURI(SERIAL), "fixture://components/updated.json", "metadata remains editable");
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        components.transferFrom(OWNER, BUYER, tokenId);
        assertEq(manager.ownerOf(SERIAL), BUYER, "inactive and missing tokens remain transferable");
        assertEq(inactive(), decommissioned, "transfer must not change lifecycle");
        assertEq(manager.missingStatus(SERIAL), missing, "transfer must not close report");
        if (missing) assertOpenReport();
        vm.prank(BUYER);
        manager.setComponentMetadata(SERIAL, "fixture://components/buyer.json");
        assertEq(manager.componentURI(SERIAL), "fixture://components/buyer.json", "buyer retains metadata power");
    }

    function test_rolesDelegationAndErc721ApprovalDoNotGrantLifecyclePower() external {
        vm.prank(OWNER);
        manager.setComponentDelegate(SERIAL, DELEGATE, REGISTRY_CAPABILITIES, uint48(block.timestamp + 1 days));
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        components.approve(OPERATOR, tokenId);
        address[4] memory actors = [address(this), REGISTRAR, DELEGATE, OPERATOR];
        // First prove the owner entrypoint exists; unknown-function reverts
        // must never masquerade as successful authorization coverage.
        transition(OWNER, true);
        for (uint256 i; i < actors.length; i++) rejectTransition(actors[i], false);
        assertTrue(inactive(), "unauthorized reactivation must preserve state");
        transition(OWNER, false);
        for (uint256 i; i < actors.length; i++) rejectTransition(actors[i], true);
        assertFalse(inactive(), "unauthorized decommission must preserve state");
    }

    function test_managerPauseBlocksBothLifecycleWrites() external {
        transition(OWNER, true);
        manager.pause();
        expectPausedTransition(false);
        manager.unpause();
        transition(OWNER, false);
        manager.pause();
        expectPausedTransition(true);
    }

    function test_lifecycleAuthorityFollowsCurrentOwnerNotPreviousOwnerOrOperator() external {
        transition(OWNER, true);
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        components.transferFrom(OWNER, BUYER, tokenId);
        vm.prank(BUYER);
        components.setApprovalForAll(OPERATOR, true);
        rejectTransition(OWNER, false);
        rejectTransition(OPERATOR, false);
        transition(BUYER, false);
        rejectTransition(OWNER, true);
        rejectTransition(OPERATOR, true);
        transition(BUYER, true);
        assertTrue(inactive(), "buyer owns lifecycle authority after transfer");
    }

    function test_lifecycleReadRejectsEmptySerialAndUsesFalseForUnknownSerial() external view {
        assertFalse(inactive(), "registered active control must support lifecycle read");
        (bool emptyOk, bytes memory emptyResult) = address(manager).staticcall(
            abi.encodeCall(IBicycleLifecycleRoadmap.inactiveStatus, (""))
        );
        assertFalse(emptyOk, "empty serial must not be a lifecycle lookup");
        assertEq(emptyResult, abi.encodeWithSelector(BicycleComponentManager.EmptySerialNumber.selector), "empty serial error");
        (bool unknownOk, bytes memory unknownResult) = address(manager).staticcall(
            abi.encodeCall(IBicycleLifecycleRoadmap.inactiveStatus, ("UNKNOWN-ROADMAP-SERIAL"))
        );
        // Like missingStatus, false is a default, not proof of registration.
        assertTrue(unknownOk, "unknown lifecycle reads use the existing false-status sentinel convention");
        assertEq(unknownResult.length, 32, "unknown lifecycle read must return a bool");
        assertFalse(abi.decode(unknownResult, (bool)), "unknown component must not be reported inactive");
    }

    function test_bothLifecycleWritesRejectEmptyAndUnknownSerials() external {
        transition(OWNER, true);
        transition(OWNER, false);
        bytes4[2] memory selectors = [
            IBicycleLifecycleRoadmap.decommissionComponent.selector,
            IBicycleLifecycleRoadmap.reactivateComponent.selector
        ];
        string memory unknownSerial = "UNKNOWN-ROADMAP-SERIAL";
        for (uint256 i; i < selectors.length; i++) {
            vm.prank(OWNER);
            (bool emptyOk, bytes memory emptyResult) = address(manager).call(abi.encodeWithSelector(selectors[i], ""));
            assertFalse(emptyOk, "lifecycle writes must reject empty serial");
            assertEq(emptyResult, abi.encodeWithSelector(BicycleComponentManager.EmptySerialNumber.selector), "empty serial error");
            vm.prank(OWNER);
            (bool unknownOk, bytes memory unknownResult) = address(manager).call(
                abi.encodeWithSelector(selectors[i], unknownSerial)
            );
            assertFalse(unknownOk, "lifecycle writes must reject unregistered serial");
            assertEq(
                unknownResult,
                abi.encodeWithSelector(BicycleComponentManager.ComponentNotRegistered.selector, keccak256(bytes(unknownSerial))),
                "unregistered serial must fail at manager registration boundary"
            );
        }
        assertFalse(inactive(), "invalid lifecycle inputs must preserve valid component state");
    }

    function testFuzz_managerPauseDoesNotFreezeErc721Transfers(bool decommissioned, bool missing) external {
        prepareLifecycle(decommissioned, missing);
        manager.pause();
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        components.transferFrom(OWNER, BUYER, tokenId);
        assertEq(manager.ownerOf(SERIAL), BUYER, "manager pause must not freeze independent NFT transfer");
        assertEq(inactive(), decommissioned, "transfer under manager pause preserves lifecycle");
        assertEq(manager.missingStatus(SERIAL), missing, "transfer under manager pause preserves report status");
    }

    function testFuzz_tokenPauseBlocksTransfersInEveryLifecycle(bool decommissioned, bool missing) external {
        prepareLifecycle(decommissioned, missing);
        components.pause();
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        vm.prank(OWNER);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        components.transferFrom(OWNER, BUYER, tokenId);
        assertEq(manager.ownerOf(SERIAL), OWNER, "token pause must preserve ownership");
        assertEq(inactive(), decommissioned, "rejected transfer preserves lifecycle");
        assertEq(manager.missingStatus(SERIAL), missing, "rejected transfer preserves report status");
    }

    function prepareLifecycle(bool decommissioned, bool missing) private {
        if (decommissioned) transition(OWNER, true);
        if (missing) {
            vm.prank(OWNER);
            manager.markComponentMissing(SERIAL, REPORT);
        }
    }

    function inactive() private view returns (bool) {
        (bool ok, bytes memory result) = address(manager).staticcall(
            abi.encodeCall(IBicycleLifecycleRoadmap.inactiveStatus, (SERIAL))
        );
        assertTrue(ok, "roadmap missing: inactiveStatus(string) must expose independent lifecycle flag");
        assertEq(result.length, 32, "inactiveStatus must return one ABI bool");
        return abi.decode(result, (bool));
    }

    function transition(address actor, bool decommission) private {
        vm.prank(actor);
        (bool ok,) = address(manager).call(transitionCall(decommission));
        assertTrue(ok, "roadmap missing: current owner must be able to change reversible lifecycle");
    }

    function rejectTransition(address actor, bool decommission) private {
        vm.prank(actor);
        (bool ok,) = address(manager).call(transitionCall(decommission));
        assertFalse(ok, "only current owner may change lifecycle, regardless of roles or approvals");
    }

    function expectPausedTransition(bool decommission) private {
        vm.prank(OWNER);
        (bool ok, bytes memory result) = address(manager).call(transitionCall(decommission));
        assertFalse(ok, "manager pause must block lifecycle writes");
        assertEq(result, abi.encodeWithSelector(Pausable.EnforcedPause.selector), "lifecycle must obey manager pause");
    }

    function transitionCall(bool decommission) private pure returns (bytes memory) {
        return decommission
            ? abi.encodeCall(IBicycleLifecycleRoadmap.decommissionComponent, (SERIAL))
            : abi.encodeCall(IBicycleLifecycleRoadmap.reactivateComponent, (SERIAL));
    }

    function assertOpenReport() private view {
        assertTrue(manager.missingStatus(SERIAL), "lifecycle changes must preserve open report");
        assertEq(manager.componentBySerial(SERIAL).missingReportURI, REPORT, "lifecycle must preserve report URI");
    }
}
