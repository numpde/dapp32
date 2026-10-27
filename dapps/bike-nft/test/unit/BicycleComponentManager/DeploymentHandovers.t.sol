pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {BicycleComponents} from "../../../src/BicycleComponents.sol";
import {BicycleComponentManager} from "../../../src/BicycleComponentManager.sol";
import {BicycleComponentManagerUI} from "../../../src/BicycleComponentManagerUI.sol";

contract DeploymentHandoversTest is Test {
    // The deployed handover ABI predates the two appended pause fields.
    struct PublishedDeploymentHandovers {
        BicycleComponentManagerUI.AuthorityHandover cam;
        BicycleComponentManagerUI.AuthorityHandover components;
        BicycleComponentManagerUI.AuthorityHandover manager;
        string[] actions;
    }

    CamRoot root;
    BicycleComponents components;
    BicycleComponentManager manager;
    BicycleComponentManagerUI ui;
    address constant NOMINEE = address(0xBEEF);
    address constant OTHER = address(0xCAFE);

    function setUp() public {
        vm.warp(1000);
        root = new CamRoot(address(this), "https://example.test/main.json", bytes32(0));
        components = new BicycleComponents("Components", "BIKE", address(this), 100, "", "data:application/json,{}");
        manager = new BicycleComponentManager(address(this), 200, address(components));
        ui = new BicycleComponentManagerUI(address(manager));
        root.setContractAddress("BicycleComponents", address(components));
        root.setContractAddress("BicycleComponentManager", address(manager));
    }

    function test_publishedDecoderReadsNewHandoverReturnBeforeResourcePublication() public {
        root.transferOwnership(NOMINEE);
        components.beginDefaultAdminTransfer(NOMINEE);
        manager.beginDefaultAdminTransfer(OTHER);
        manager.pause();
        (bool success, bytes memory encoded) = address(ui)
            .staticcall(abi.encodeCall(BicycleComponentManagerUI.viewDeploymentHandovers, (address(root), NOMINEE)));
        assertTrue(success);
        PublishedDeploymentHandovers memory published = abi.decode(encoded, (PublishedDeploymentHandovers));
        assertEq(published.cam.target, address(root));
        assertEq(published.cam.pending, NOMINEE);
        assertTrue(published.cam.canAccept);
        assertEq(published.components.target, address(components));
        assertEq(published.components.readyAt, 1100);
        assertEq(published.manager.target, address(manager));
        assertEq(published.manager.pending, OTHER);
        assertEq(published.actions.length, 1);
        assertEq(published.actions[0], "acceptCamOwnership");
        BicycleComponentManagerUI.DeploymentHandovers memory current =
            abi.decode(encoded, (BicycleComponentManagerUI.DeploymentHandovers));
        assertTrue(current.paused);
        assertFalse(current.componentTokenPaused);
    }

    function test_pauseFactsFollowHostBindingsIndependentlyOfUiRegistryAndItsCollection() public {
        BicycleComponents replacement =
            new BicycleComponents("Other", "OTHER", address(this), 100, "", "data:application/json,{}");
        BicycleComponentManager replacementManager =
            new BicycleComponentManager(address(this), 200, address(components));
        root.setContractAddress("BicycleComponents", address(replacement));
        root.setContractAddress("BicycleComponentManager", address(replacementManager));
        manager.pause();
        replacement.pause();
        BicycleComponentManagerUI.DeploymentHandovers memory view_ = ui.viewDeploymentHandovers(address(root), OTHER);
        assertFalse(view_.paused, "the bound registry is unpaused even though the UI constructor registry is paused");
        assertTrue(view_.componentTokenPaused, "the bound collection differs from the registry's current collection");
        replacementManager.pause();
        replacement.unpause();
        manager.unpause();
        components.pause();
        view_ = ui.viewDeploymentHandovers(address(root), OTHER);
        assertTrue(view_.paused);
        assertFalse(view_.componentTokenPaused);
    }

    function test_noNominationNeverOffersAcceptanceIncludingZeroAccount() public view {
        assertEq(ui.viewDeploymentHandovers(address(root), NOMINEE).actions.length, 0);
        assertEq(ui.viewDeploymentHandovers(address(root), address(0)).actions.length, 0);
    }

    function test_nomineesAndStrictChainDeadlinesAreIndependent() public {
        root.transferOwnership(NOMINEE);
        components.beginDefaultAdminTransfer(NOMINEE);
        manager.beginDefaultAdminTransfer(OTHER);
        BicycleComponentManagerUI.DeploymentHandovers memory view_ = ui.viewDeploymentHandovers(address(root), NOMINEE);
        assertEq(view_.cam.current, address(this));
        assertEq(view_.cam.pending, NOMINEE);
        assertEq(view_.components.readyAt, 1100);
        assertEq(view_.manager.readyAt, 1200);
        assertEq(view_.actions.length, 1);
        assertEq(view_.actions[0], "acceptCamOwnership");
        vm.warp(1100);
        assertEq(ui.viewDeploymentHandovers(address(root), NOMINEE).actions.length, 1);
        vm.expectRevert();
        vm.prank(NOMINEE);
        components.acceptDefaultAdminTransfer();
        vm.warp(1101);
        assertEq(ui.viewDeploymentHandovers(address(root), NOMINEE).actions.length, 2);
        assertEq(ui.viewDeploymentHandovers(address(root), OTHER).actions.length, 0);
        vm.warp(1201);
        assertEq(ui.viewDeploymentHandovers(address(root), OTHER).actions[0], "acceptManagerAdmin");
    }

    function test_directAcceptanceAndCancelledNominationRefreshTheScreen() public {
        root.transferOwnership(NOMINEE);
        components.beginDefaultAdminTransfer(NOMINEE);
        manager.beginDefaultAdminTransfer(NOMINEE);
        vm.warp(1201);
        vm.startPrank(NOMINEE);
        root.acceptOwnership();
        components.acceptDefaultAdminTransfer();
        manager.acceptDefaultAdminTransfer();
        vm.stopPrank();
        BicycleComponentManagerUI.DeploymentHandovers memory view_ = ui.viewDeploymentHandovers(address(root), NOMINEE);
        assertEq(view_.actions.length, 0);
        assertEq(view_.cam.current, NOMINEE);
        assertEq(view_.components.current, NOMINEE);
        assertEq(view_.manager.current, NOMINEE);
        vm.prank(NOMINEE);
        manager.beginDefaultAdminTransfer(OTHER);
        vm.warp(1402);
        assertEq(ui.viewDeploymentHandovers(address(root), OTHER).actions.length, 1);
        vm.prank(NOMINEE);
        manager.cancelDefaultAdminTransfer();
        assertEq(ui.viewDeploymentHandovers(address(root), OTHER).actions.length, 0);
    }

    function test_destinationsFollowHostBindingsWithoutTrustingOwnershipAlias() public {
        root.setContractAddress("ICamRootOwnership", OTHER);
        BicycleComponents replacement =
            new BicycleComponents("Other", "OTHER", address(this), 100, "", "data:application/json,{}");
        root.setContractAddress("BicycleComponents", address(replacement));
        (address cam, address collection, address registry) = ui.deploymentTargets(address(root));
        assertEq(cam, address(root));
        assertEq(collection, address(replacement));
        assertEq(registry, address(manager));
        assertEq(ui.viewDeploymentHandovers(address(root), NOMINEE).components.target, collection);
    }
}
