pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../../src/BicycleComponentManager.sol";
import "../../../src/BicycleComponentManagerUI.sol";
import "../../../src/BicycleComponents.sol";
import "../../../src/IBicycleComponentManagerView.sol";

contract BicycleComponentManagerTest is Test {
    BicycleComponents private components;
    BicycleComponentManager private manager;
    BicycleComponentManagerUI private ui;

    address private admin = address(this);
    address private registrar = address(0x1001);
    address private statusAttester = address(0x1002);
    address private owner = address(0x2001);
    address private secondOwner = address(0x2002);
    address private delegate = address(0x3001);
    address private stranger = address(0x4001);

    string private constant SERIAL = "BIKE-FRAME-001";
    string private constant SECOND_SERIAL = "BIKE-WHEEL-002";
    string private constant TOKEN_URI = "fixture://bike-nft/components/frame-001.json";
    string private constant UPDATED_TOKEN_URI = "fixture://bike-nft/components/frame-001-updated.json";

    string private constant VIEW_ENTRY = "entry";
    string private constant VIEW_COMPONENT_EMPTY = "component.empty";
    string private constant VIEW_COMPONENT_FOUND = "component.found";
    string private constant VIEW_COMPONENT_NOT_FOUND = "component.notFound";
    string private constant VIEW_REGISTER_EMPTY = "register.empty";
    string private constant VIEW_REGISTER_READY = "register.ready";
    string private constant VIEW_REGISTER_BLOCKED = "register.blocked";

    string private constant ACTION_LOOKUP_COMPONENT = "lookupComponent";
    string private constant ACTION_OPEN_REGISTER = "openRegister";
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
        manager.grantRole(manager.STATUS_ATTESTER_ROLE(), statusAttester);
    }

    function test_registrationRequiresRegistrarAndManagerViewsReflectTokenState() external {
        uint256 expectedTokenId = manager.tokenIdOf(SERIAL);
        bytes32 expectedSerialHash = manager.serialHashOf(SERIAL);

        vm.prank(stranger);
        vm.expectRevert();
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(owner, SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(components), "component contract mismatch");
        assertEq(tokenId, expectedTokenId, "token id must derive from serial hash");
        assertEq(components.ownerOf(tokenId), owner, "component token owner mismatch");
        assertEq(components.tokenURI(tokenId), TOKEN_URI, "component token URI mismatch");
        assertTrue(manager.isRegistered(SERIAL), "manager should mark serial registered");

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(SERIAL);
        assertTrue(component.exists, "component view should exist");
        assertEq(component.serialHash, expectedSerialHash, "serial hash mismatch");
        assertEq(component.tokenContract, address(components), "token contract mismatch");
        assertEq(component.tokenId, expectedTokenId, "component view token id mismatch");
        assertEq(component.owner, owner, "component view owner mismatch");
        assertEq(component.registrar, registrar, "component view registrar mismatch");
        assertEq(uint8(component.status), uint8(IBicycleComponentManagerView.ComponentStatus.Active), "status mismatch");
        assertEq(component.tokenURI, TOKEN_URI, "component view token URI mismatch");
        assertEq(component.serialNumber, SERIAL, "component view serial mismatch");

        vm.prank(registrar);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.ComponentAlreadyRegistered.selector, manager.serialHashOf(SERIAL)
            )
        );
        manager.registerComponent(secondOwner, SERIAL, TOKEN_URI);
    }

    function test_uiRouteProjectionSelectsViewsAndValidActions() external {
        BicycleComponentManagerUI.AppView memory view_ = ui.viewEntry(registrar);
        assertEq(view_.viewId, VIEW_ENTRY, "entry view mismatch");
        assertEq(view_.account, registrar, "entry account mismatch");
        assertTrue(view_.canRegister, "entry account should be allowed to register");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT, ACTION_OPEN_REGISTER));

        view_ = ui.viewComponent("", owner);
        assertEq(view_.viewId, VIEW_COMPONENT_EMPTY, "empty component view mismatch");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT, ACTION_OPEN_REGISTER));

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_NOT_FOUND, "missing component view mismatch");
        assertEq(view_.serialNumber, SERIAL, "missing component serial mismatch");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT, ACTION_OPEN_REGISTER));

        view_ = ui.viewRegister("", registrar);
        assertEq(view_.viewId, VIEW_REGISTER_EMPTY, "empty register view mismatch");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT, ACTION_OPEN_REGISTER));

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_READY, "ready register view mismatch");
        assertEq(view_.componentsAddress, address(components), "register component address mismatch");
        assertActions(view_.actions, actionSet(ACTION_REGISTER_COMPONENT, ACTION_LOOKUP_COMPONENT));

        view_ = ui.viewRegister(SERIAL, stranger);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "unauthorized register view mismatch");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT));

        registerDefaultComponent();

        view_ = ui.viewComponent(SERIAL, owner);
        assertEq(view_.viewId, VIEW_COMPONENT_FOUND, "found component view mismatch");
        assertEq(view_.tokenURI, TOKEN_URI, "found component token URI mismatch");
        assertActions(
            view_.actions,
            actionSet(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_MARK_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        vm.prank(owner);
        manager.markMissing(SERIAL);

        view_ = ui.viewComponent(SERIAL, owner);
        assertActions(
            view_.actions,
            actionSet(
                ACTION_LOOKUP_COMPONENT,
                ACTION_UPDATE_COMPONENT_METADATA,
                ACTION_CLEAR_COMPONENT_MISSING,
                ACTION_RETIRE_COMPONENT
            )
        );

        view_ = ui.viewRegister(SERIAL, registrar);
        assertEq(view_.viewId, VIEW_REGISTER_BLOCKED, "registered component register view mismatch");
        assertActions(view_.actions, actionSet(ACTION_LOOKUP_COMPONENT));
    }

    function test_configurerCanChangeComponentAddressForFutureRegistrationsOnly() external {
        registerDefaultComponent();

        BicycleComponents secondComponents = new BicycleComponents("Bike Components 2", "BIKE2", admin, 0, "", "");
        secondComponents.grantRole(secondComponents.MINTER_ROLE(), address(manager));
        secondComponents.grantRole(secondComponents.TOKEN_URI_SETTER_ROLE(), address(manager));

        vm.prank(stranger);
        vm.expectRevert();
        manager.setComponentsAddress(address(secondComponents));

        vm.expectRevert(BicycleComponentManager.ZeroAddress.selector);
        manager.setComponentsAddress(address(0));

        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.ComponentsHasNoCode.selector, address(0xdead)));
        manager.setComponentsAddress(address(0xdead));

        manager.setComponentsAddress(address(secondComponents));
        assertEq(manager.componentsAddress(), address(secondComponents), "component address mismatch");

        vm.prank(registrar);
        (address tokenContract, uint256 tokenId) = manager.registerComponent(secondOwner, SECOND_SERIAL, TOKEN_URI);

        assertEq(tokenContract, address(secondComponents), "future registration should use new component contract");
        assertEq(secondComponents.ownerOf(tokenId), secondOwner, "new component owner mismatch");
        assertEq(
            manager.componentBySerial(SERIAL).tokenContract,
            address(components),
            "existing record should keep original component contract"
        );
    }

    function test_registeredComponentViewsPropagateTokenReadFailures() external {
        RevertingReadComponents failingComponents = new RevertingReadComponents();
        manager.setComponentsAddress(address(failingComponents));

        vm.prank(registrar);
        manager.registerComponent(owner, SECOND_SERIAL, TOKEN_URI);

        IBicycleComponentManagerView.ComponentView memory component = manager.componentBySerial(SECOND_SERIAL);
        assertEq(component.owner, owner, "component owner mismatch before read failure");
        assertEq(component.tokenURI, TOKEN_URI, "component URI mismatch before read failure");

        failingComponents.setRevertReads(true);

        vm.expectRevert(RevertingReadComponents.ReadsDisabled.selector);
        manager.ownerOf(SECOND_SERIAL);

        vm.expectRevert(RevertingReadComponents.ReadsDisabled.selector);
        manager.componentBySerial(SECOND_SERIAL);
    }

    function test_emptySerialNumberIsRejectedAtManagerBoundary() external {
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.serialHashOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.tokenIdOf("");

        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.componentBySerial("");

        vm.prank(registrar);
        vm.expectRevert(BicycleComponentManager.EmptySerialNumber.selector);
        manager.registerComponent(owner, "", TOKEN_URI);
    }

    function test_ownerAndDelegatesCanUpdateMetadataOnlyWhileAuthorizedAndBeforeExpiryOrTransfer() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        uint64 updateMetadataCapability = manager.CAP_UPDATE_METADATA();
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint48 validUntil = uint48(block.timestamp + 1 days);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                BicycleComponentManager.Unauthorized.selector, stranger, serialHash, updateMetadataCapability
            )
        );
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);

        vm.prank(owner);
        manager.setComponentMetadata(SERIAL, UPDATED_TOKEN_URI);
        assertEq(components.tokenURI(manager.tokenIdOf(SERIAL)), UPDATED_TOKEN_URI, "owner metadata update failed");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, updateMetadataCapability, uint48(block.timestamp + 1 days));

        vm.prank(delegate);
        manager.setComponentMetadata(SERIAL, TOKEN_URI);
        assertEq(components.tokenURI(manager.tokenIdOf(SERIAL)), TOKEN_URI, "delegate metadata update failed");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, markMissingCapability, validUntil);

        assertEq(manager.permissionsOf(delegate, SERIAL), markMissingCapability, "delegate should be active");

        vm.warp(validUntil);
        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "delegate should expire at validUntil");

        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, markMissingCapability, uint48(block.timestamp + 1 days));

        uint256 tokenId = manager.tokenIdOf(SERIAL);

        vm.prank(owner);
        components.transferFrom(owner, secondOwner, tokenId);

        assertEq(manager.permissionsOf(delegate, SERIAL), 0, "old-owner delegation must not survive transfer");
    }

    function test_ownerAndDelegatesCanMoveThroughMissingAndRetiredStatuses() external {
        registerDefaultComponent();
        uint64 markMissingCapability = manager.CAP_MARK_MISSING();
        uint64 clearMissingCapability = manager.CAP_CLEAR_MISSING();
        uint64 retireCapability = manager.CAP_RETIRE();

        vm.prank(owner);
        manager.markMissing(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Missing),
            "component should be missing"
        );

        vm.prank(owner);
        manager.clearMissing(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Active),
            "component should be active again"
        );

        uint64 capabilities = markMissingCapability | clearMissingCapability | retireCapability;
        vm.prank(owner);
        manager.setComponentDelegate(SERIAL, delegate, capabilities, uint48(block.timestamp + 1 days));

        vm.prank(delegate);
        manager.markMissing(SERIAL);
        assertTrue(manager.missingStatus(SERIAL), "delegate should mark missing");

        vm.prank(delegate);
        manager.clearMissing(SERIAL);
        assertFalse(manager.missingStatus(SERIAL), "delegate should clear missing");

        vm.prank(delegate);
        manager.retireComponent(SERIAL);
        assertEq(
            uint8(manager.componentStatus(SERIAL)),
            uint8(IBicycleComponentManagerView.ComponentStatus.Retired),
            "component should be retired"
        );
    }

    function test_pausedManagerRejectsRegistryWrites() external {
        manager.pause();

        vm.prank(registrar);
        vm.expectRevert();
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.unpause();

        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);

        manager.pause();

        vm.prank(owner);
        vm.expectRevert();
        manager.markMissing(SERIAL);
    }

    function test_onlyRegistrarOrStatusAttesterCanAddComponentAttestation() external {
        registerDefaultComponent();

        bytes32 serialHash = manager.serialHashOf(SERIAL);
        bytes32 attestationType = keccak256("inspection");

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(BicycleComponentManager.Unauthorized.selector, stranger, serialHash, 0));
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/unauthorized.json");

        vm.prank(registrar);
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/registrar.json");

        vm.prank(statusAttester);
        manager.addComponentAttestation(SERIAL, attestationType, "fixture://attestations/status-attester.json");
    }

    function assertActions(string[] memory actual, string[] memory expected) private pure {
        assertEq(actual.length, expected.length, "action count mismatch");

        for (uint256 index; index < expected.length; index++) {
            assertEq(actual[index], expected[index], "action mismatch");
        }
    }

    function actionSet(string memory first) private pure returns (string[] memory actions) {
        actions = new string[](1);
        actions[0] = first;
    }

    function actionSet(string memory first, string memory second) private pure returns (string[] memory actions) {
        actions = new string[](2);
        actions[0] = first;
        actions[1] = second;
    }

    function actionSet(string memory first, string memory second, string memory third, string memory fourth)
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

    function registerDefaultComponent() private {
        vm.prank(registrar);
        manager.registerComponent(owner, SERIAL, TOKEN_URI);
    }
}

contract RevertingReadComponents is IBicycleComponents {
    error ReadsDisabled();
    error TokenAlreadyExists(uint256 tokenId);
    error TokenDoesNotExist(uint256 tokenId);
    error UnsupportedFixtureCall();
    error WrongTokenOwner(address from, uint256 tokenId);
    error ZeroAddress();

    string private constant COLLECTION_NAME = "Failing Bike Components";
    string private constant COLLECTION_SYMBOL = "FBIKE";
    string private constant BASE_URI = "fixture://bike-nft/failing-components/";
    string private constant CONTRACT_URI = "fixture://bike-nft/failing-components.json";

    bool private _revertReads;
    mapping(uint256 tokenId => address owner) private _owners;
    mapping(uint256 tokenId => string uri) private _uris;
    mapping(address owner => uint256 balance) private _balances;

    function setRevertReads(bool revertReads) external {
        _revertReads = revertReads;
    }

    function mint(address to, uint256 tokenId, string calldata uri) external {
        _mint(to, tokenId, uri);
    }

    function safeMint(address to, uint256 tokenId, string calldata uri, bytes calldata) external {
        _mint(to, tokenId, uri);
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external {
        _requireOwner(tokenId);
        _uris[tokenId] = uri;
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _owners[tokenId] != address(0);
    }

    function baseURI() external pure returns (string memory) {
        return BASE_URI;
    }

    function contractURI() external pure returns (string memory) {
        return CONTRACT_URI;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IBicycleComponents).interfaceId;
    }

    function balanceOf(address owner_) external view returns (uint256) {
        return _balances[owner_];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        if (_revertReads) revert ReadsDisabled();
        return _requireOwner(tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }

    function transferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
    }

    function approve(address, uint256) external pure {
        revert UnsupportedFixtureCall();
    }

    function setApprovalForAll(address, bool) external pure {
        revert UnsupportedFixtureCall();
    }

    function getApproved(uint256) external pure returns (address) {
        revert UnsupportedFixtureCall();
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        revert UnsupportedFixtureCall();
    }

    function name() external pure returns (string memory) {
        return COLLECTION_NAME;
    }

    function symbol() external pure returns (string memory) {
        return COLLECTION_SYMBOL;
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_revertReads) revert ReadsDisabled();
        _requireOwner(tokenId);
        return _uris[tokenId];
    }

    function _mint(address to, uint256 tokenId, string calldata uri) private {
        if (to == address(0)) revert ZeroAddress();
        if (_owners[tokenId] != address(0)) revert TokenAlreadyExists(tokenId);

        _owners[tokenId] = to;
        _balances[to] += 1;
        _uris[tokenId] = uri;
    }

    function _transfer(address from, address to, uint256 tokenId) private {
        if (to == address(0)) revert ZeroAddress();
        if (_requireOwner(tokenId) != from) revert WrongTokenOwner(from, tokenId);

        _owners[tokenId] = to;
        _balances[from] -= 1;
        _balances[to] += 1;
    }

    function _requireOwner(uint256 tokenId) private view returns (address owner_) {
        owner_ = _owners[tokenId];
        if (owner_ == address(0)) revert TokenDoesNotExist(tokenId);
    }
}
