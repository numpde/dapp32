pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponentManagerUI.sol";
import "../../../src/BicycleComponents.sol";
import "../../../src/IBicycleComponentManagerView.sol";

contract BicycleComponentManagerScenarioTest is Test {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    address private admin = address(this);
    address private registrar = address(0x1001);
    address private owner = address(0x2001);
    address private buyer = address(0x2002);
    address private delegate = address(0x3001);

    string private constant SERIAL = "SCENARIO-FRAME-001";
    string private constant SECOND_SERIAL = "SCENARIO-WHEEL-002";
    string private constant TOKEN_URI = "fixture://bike-nft/scenario/frame-001.json";
    string private constant UPDATED_TOKEN_URI = "fixture://bike-nft/scenario/frame-001-updated.json";
    string private constant SECOND_TOKEN_URI = "fixture://bike-nft/scenario/wheel-002.json";
    string private constant BUYER_INFO_URI = "fixture://bike-nft/accounts/buyer.json";

    string private constant VIEW_COMPONENT_FOUND = "component.found";
    string private constant VIEW_REGISTER_READY = "register.ready";
    string private constant VIEW_REGISTER_BLOCKED = "register.blocked";

    string private constant ACTION_LOOKUP_COMPONENT = "lookupComponent";
    string private constant ACTION_REGISTER_COMPONENT = "registerComponent";
    string private constant ACTION_UPDATE_COMPONENT_METADATA = "updateComponentMetadata";
    string private constant ACTION_MARK_COMPONENT_MISSING = "markComponentMissing";
    string private constant ACTION_CLEAR_COMPONENT_MISSING = "clearComponentMissing";
    string private constant ACTION_RETIRE_COMPONENT = "retireComponent";

    function setUp() external {
        components = new BicycleComponents("Bike Components", "BIKE", admin, 0, "", "");
        manager = new BicycleComponentManager(admin, 0, address(components));
        ui = new BicycleComponentManagerUI(address(manager));

        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.grantRole(manager.REGISTRAR_ROLE(), registrar);
    }

    // A happy-path registrar flow should keep the manager record, ERC721 token,
    // and read-only UI projection in lockstep across registration and metadata
    // update.
    function test_registrarRegistrationFlowKeepsManagerTokenAndUiProjectionAligned() external {
        BicycleComponentManagerUI.AppView memory view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_READY, "registrar should see registration-ready view");
        assertEq(view_.componentsAddress, address(components), "registration view should expose active collection");
        assertActions(view_.actions, expectedActions(ACTION_REGISTER_COMPONENT, ACTION_LOOKUP_COMPONENT));

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(owner, SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(components), "registered token contract mismatch");
        assertEq(tokenId, manager.tokenIdOf(SERIAL), "token id should be serial-derived");
        assertEq(components.ownerOf(tokenId), owner, "component owner mismatch");
        assertEq(components.tokenURI(tokenId), TOKEN_URI, "component token URI mismatch");

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "component route should find registered component");
        assertEq(view_.owner, owner, "component view owner mismatch");
        assertEq(view_.tokenContract, address(components), "component view token contract mismatch");
        assertEq(view_.tokenId, tokenId, "component view token id mismatch");
        assertEq(view_.tokenURI, TOKEN_URI, "component view token URI mismatch");
        assertActions(
            view_.actions,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_MARK_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "registered serial should no longer be registerable");
        assertActions(view_.actions, expectedActions(ACTION_LOOKUP_COMPONENT));

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        assertEq(components.tokenURI(tokenId), UPDATED_TOKEN_URI, "metadata update should hit the NFT contract");
        assertEq(ui.viewComponent(SERIAL, owner).tokenURI, UPDATED_TOKEN_URI, "UI route should show updated metadata");
    }

    // A used-bike sale is where ownership, delegation, status, account metadata,
    // and UI actions cross contract boundaries. The old owner/delegate must lose
    // control immediately when the ERC721 owner changes.
    function test_usedBikeSaleInvalidatesOldDelegationAndMovesUiControlToBuyer() external {
        registerDefaultComponent();
        uint256 tokenId = manager.tokenIdOf(SERIAL);
        uint64 allCapabilities = manager.VALID_CAPABILITY_MASK();

        vm.prank(buyer);
        manager.setAccountInfo(BUYER_INFO_URI);

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, allCapabilities, uint48(block.timestamp + 7 days));

        vm.prank(delegate);
        manager.markMissing(SERIAL);

        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "delegate should mark component missing before sale"
        );
        assertActions(
            ui.viewComponent(SERIAL, delegate).actions,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_CLEAR_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        vm.prank(owner);
        components.transferFrom(owner, buyer, tokenId);

        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "old delegate must lose permissions after sale");
        assertEq(manager.permissionsOf(owner, SERIAL), 0, "old owner must lose permissions after sale");
        assertActions(ui.viewComponent(SERIAL, delegate).actions, expectedActions(ACTION_LOOKUP_COMPONENT));

        BicycleComponentManagerUI.AppView memory buyerView = ui.viewComponent(SERIAL, buyer);
        assertEq(buyerView.owner, buyer, "buyer should become component owner");
        assertEq(buyerView.ownerInfo, BUYER_INFO_URI, "buyer profile should follow current owner");
        assertActions(
            buyerView.actions,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_CLEAR_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        vm.prank(buyer);
        manager.clearMissing(SERIAL);
        assertActions(
            ui.viewComponent(SERIAL, buyer).actions,
            expectedActions(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_MARK_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        vm.prank(buyer);
        manager.retireComponent(SERIAL);
        assertActions(ui.viewComponent(SERIAL, buyer).actions, expectedActions(ACTION_LOOKUP_COMPONENT));
    }

    // Component collection rotation is a configuration lifecycle scenario:
    // existing records must keep their original token contract while future
    // registrations use the replacement collection.
    function test_componentCollectionRolloverPreservesOldRecordsAndUsesNewCollectionForFutureRegistrations() external {
        registerDefaultComponent();
        uint256 oldTokenId = manager.tokenIdOf(SERIAL);

        BicycleComponents nextComponents = new BicycleComponents("Next Bike Components", "NBIKE", admin, 0, "", "");
        nextComponents.grantRole(nextComponents.MINTER_ROLE(), address(manager));
        nextComponents.grantRole(nextComponents.TOKEN_URI_SETTER_ROLE(), address(manager));

        manager.setComponentsAddress(address(nextComponents));

        vm.prank(registrar);
        (address nextTokenContract, uint256 nextTokenId) =
            manager.registerComponent(buyer, SECOND_SERIAL, SECOND_TOKEN_URI);

        assertEq(nextTokenContract, address(nextComponents), "future registrations should use new collection");
        assertEq(nextComponents.ownerOf(nextTokenId), buyer, "new collection owner mismatch");

        BicycleComponentManagerUI.AppView memory oldView = ui.viewComponent(SERIAL, owner);
        BicycleComponentManagerUI.AppView memory newView = ui.viewComponent(SECOND_SERIAL, buyer);

        assertEq(oldView.tokenContract, address(components), "old record should keep original collection");
        assertEq(oldView.owner, owner, "old record owner mismatch");
        assertEq(newView.tokenContract, address(nextComponents), "new record should use replacement collection");
        assertEq(newView.owner, buyer, "new record owner mismatch");

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
        assertEq(
            components.tokenURI(oldTokenId), UPDATED_TOKEN_URI, "old metadata update should use original collection"
        );

        vm.prank(buyer);
        manager.setComponentMetadata(SECOND_SERIAL, UPDATED_TOKEN_URI);
        assertEq(
            nextComponents.tokenURI(nextTokenId),
            UPDATED_TOKEN_URI,
            "new metadata update should use replacement collection"
        );
    }

    function registerDefaultComponent() private {
        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);
    }

    function assertActions(string[] memory actual, string[] memory expected) private pure {
        assertEq(actual.length, expected.length, "action count mismatch");

        for (uint256 index; index < expected.length; index++) {
            assertEq(actual[index], expected[index], "action mismatch");
        }
    }

    function expectedActions(string memory first) private pure returns (string[] memory actions) {
        actions = new string[](1);
        actions[0] = first;
    }

    function expectedActions(string memory first, string memory second) private pure returns (string[] memory actions) {
        actions = new string[](2);
        actions[0] = first;
        actions[1] = second;
    }

    function expectedActions(string memory first, string memory second, string memory third, string memory fourth)
        private
        pure
        returns (string[] memory actions)
    {
        actions = new string[](4);
        actions[0] = first;
        actions[1] = second;
        actions[2] = third;
        actions[3] = fourth;
    }
}
