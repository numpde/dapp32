pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {BicycleComponentManager} from "../../src/BicycleComponentManager.sol";
import {BicycleComponents} from "../../src/BicycleComponents.sol";

/// @dev Ghost state models product law, not the manager's storage: a fresh
/// grant is valid until an actual owner change, regardless of future returns.
contract BicycleOwnershipRoadmapHandler is Test {
    BicycleComponents public components;
    BicycleComponentManager public manager;
    address public constant OWNER_A = address(0x2001);
    address public constant OWNER_B = address(0x2002);
    address public constant DELEGATE = address(0x3001);
    bool[2] public expectedActive;
    uint256 public ownershipChanges;

    constructor(BicycleComponents components_, BicycleComponentManager manager_) {
        components = components_;
        manager = manager_;
    }

    function serial(uint256 index) public pure returns (string memory) {
        return index == 0 ? "INVARIANT-ROADMAP-001" : "INVARIANT-ROADMAP-002";
    }

    function grant(uint8 seed) public {
        uint256 index = seed % 2;
        string memory component = serial(index);
        address owner = manager.ownerOf(component);
        vm.prank(owner);
        manager.setComponentDelegate(component, DELEGATE, 7, uint48(block.timestamp + 7 days));
        expectedActive[index] = true;
    }

    function revoke(uint8 seed) external {
        uint256 index = seed % 2;
        string memory component = serial(index);
        address owner = manager.ownerOf(component);
        vm.prank(owner);
        manager.revokeComponentDelegate(component, DELEGATE);
        expectedActive[index] = false;
    }

    function transfer(uint8 seed, bool selfTransfer, uint8 pathSeed) public {
        uint256 index = seed % 2;
        string memory component = serial(index);
        address from = manager.ownerOf(component);
        address to = selfTransfer ? from : (from == OWNER_A ? OWNER_B : OWNER_A);
        uint256 tokenId = manager.tokenIdOf(component);
        vm.prank(from);
        if (pathSeed % 3 == 0) components.transferFrom(from, to, tokenId);
        else if (pathSeed % 3 == 1) components.safeTransferFrom(from, to, tokenId);
        else components.safeTransferFrom(from, to, tokenId, hex"1234");
        if (from != to) {
            expectedActive[index] = false;
            ownershipChanges++;
        }
    }
}

contract BicycleOwnershipGenerationRoadmapInvariantTest is Test {
    BicycleComponentManager private manager;
    BicycleOwnershipRoadmapHandler private handler;

    function setUp() public {
        BicycleComponents components = new BicycleComponents("Bike Components", "BIKE", address(this), 0, "", "");
        manager = new BicycleComponentManager(address(this), 0, address(components));
        components.grantRole(components.MINTER_ROLE(), address(manager));
        components.grantRole(components.TOKEN_URI_SETTER_ROLE(), address(manager));
        manager.grantRole(manager.REGISTRAR_ROLE(), address(this));
        handler = new BicycleOwnershipRoadmapHandler(components, manager);
        manager.registerComponent(handler.OWNER_A(), handler.serial(0), "fixture://components/one.json");
        manager.registerComponent(handler.OWNER_A(), handler.serial(1), "fixture://components/two.json");
        handler.grant(0);
        handler.grant(1);
        // Seed a real ownership round trip so an unchanged implementation
        // cannot pass merely because a campaign never generated a return.
        handler.transfer(0, false, 0);
        handler.transfer(0, false, 1);
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = BicycleOwnershipRoadmapHandler.grant.selector;
        selectors[1] = BicycleOwnershipRoadmapHandler.revoke.selector;
        selectors[2] = BicycleOwnershipRoadmapHandler.transfer.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_grantsTrackOwnershipChangesNotOwnerAddressEquality() external view {
        assertGe(handler.ownershipChanges(), 2, "campaign must include real ownership changes");
        for (uint256 index; index < 2; index++) {
            string memory component = handler.serial(index);
            bool expected = handler.expectedActive(index);
            (,,, bool active) = manager.componentDelegation(component, handler.DELEGATE());
            assertEq(active, expected, "grant validity must match latest grant and subsequent ownership changes");
            assertEq(
                manager.permissionsOf(handler.DELEGATE(), component),
                expected ? 7 : 0,
                "stale capabilities cannot revive"
            );
        }
    }
}
