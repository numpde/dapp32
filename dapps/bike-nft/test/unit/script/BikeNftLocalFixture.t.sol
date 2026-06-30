pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../../script/BikeNftLocalFixture.sol";
import "../../../src/IBicycleComponentManagerView.sol";

/// @dev Exposes the internal deployment helpers without changing the script
/// contract's production surface. The caller is deliberately `address(this)`
/// so the test exercises the same admin/broadcaster precondition as Forge
/// broadcast scripts.
contract BikeNftLocalFixtureHarness is BikeNftLocalFixture {
    function deployCleanForTest() external returns (Deployment memory deployment) {
        deployment = deployLocalFixture(address(this), "file:///work/dapps/bike-nft/cam/main.json", bytes32(0));
    }

    function deploySeededForTest(address seedOwner) external returns (Deployment memory deployment) {
        deployment =
            deploySeededLocalFixture(address(this), seedOwner, "file:///work/dapps/bike-nft/cam/main.json", bytes32(0));
    }
}

/// @dev The local fixture is shared by developer-facing GUI/terminal scenarios.
/// This test keeps the two supported modes honest: clean deployment should be
/// empty, seeded deployment should create demo components in both the manager
/// record and the component NFT contract.
contract BikeNftLocalFixtureTest is Test {
    function test_localFixtureCanDeployCleanOrSeededDemoState() external {
        BikeNftLocalFixtureHarness harness = new BikeNftLocalFixtureHarness();

        BikeNftLocalFixture.Deployment memory deployment = harness.deployCleanForTest();

        assertFalse(
            deployment.manager.componentBySerial("DEMO-FRAME-001").exists, "clean fixture should not seed frame"
        );
        assertFalse(
            deployment.manager.componentBySerial("DEMO-BATTERY-001").exists, "clean fixture should not seed battery"
        );
        assertFalse(
            deployment.manager.componentBySerial("DEMO-MOTOR-001").exists, "clean fixture should not seed motor"
        );

        address seedOwner = makeAddr("seed owner");
        deployment = harness.deploySeededForTest(seedOwner);

        assertSeededComponent(
            deployment,
            seedOwner,
            address(harness),
            "DEMO-FRAME-001",
            "fixture://bike-nft/components/demo-frame-001.json"
        );
        assertSeededComponent(
            deployment,
            seedOwner,
            address(harness),
            "DEMO-BATTERY-001",
            "fixture://bike-nft/components/demo-battery-001.json"
        );
        assertSeededComponent(
            deployment,
            seedOwner,
            address(harness),
            "DEMO-MOTOR-001",
            "fixture://bike-nft/components/demo-motor-001.json"
        );
    }

    function assertSeededComponent(
        BikeNftLocalFixture.Deployment memory deployment,
        address owner,
        address registrar,
        string memory serialNumber,
        string memory tokenURI_
    ) private view {
        IBicycleComponentManagerView.ComponentView memory component = deployment.manager.componentBySerial(serialNumber);

        // A seeded component is only useful if the manager projection and the
        // NFT contract agree. Checking both catches fixture drift that a viewer
        // might otherwise hide behind cached route data.
        assertTrue(component.exists, "seeded component should have a manager record");
        assertEq(
            component.tokenContract, address(deployment.components), "seeded component should use configured contract"
        );
        assertEq(component.owner, owner, "seeded component owner mismatch");
        assertEq(component.registrar, registrar, "seeded component registrar mismatch");
        assertEq(uint8(component.status), uint8(IBicycleComponentManagerView.ComponentStatus.Active), "status mismatch");
        assertEq(component.tokenURI, tokenURI_, "manager token URI mismatch");
        assertEq(deployment.components.ownerOf(component.tokenId), owner, "NFT owner mismatch");
        assertEq(deployment.components.tokenURI(component.tokenId), tokenURI_, "NFT token URI mismatch");
    }
}
