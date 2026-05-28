pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import "../../../script/BikeNftLocalFixture.sol";
import "../../../src/IBicycleComponentManagerView.sol";

contract BikeNftLocalFixtureHarness is BikeNftLocalFixture {
    function deployCleanForTest() external returns (Deployment memory deployment) {
        deployment = deployLocalFixture(address(this), "file:///work/dapps/bike-nft/cam/main.json", bytes32(0));
    }

    function deploySeededForTest() external returns (Deployment memory deployment) {
        deployment = deploySeededLocalFixture(address(this), "file:///work/dapps/bike-nft/cam/main.json", bytes32(0));
    }
}

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

        deployment = harness.deploySeededForTest();

        assertSeededComponent(
            deployment, address(harness), "DEMO-FRAME-001", "fixture://bike-nft/components/demo-frame-001.json"
        );
        assertSeededComponent(
            deployment, address(harness), "DEMO-BATTERY-001", "fixture://bike-nft/components/demo-battery-001.json"
        );
        assertSeededComponent(
            deployment, address(harness), "DEMO-MOTOR-001", "fixture://bike-nft/components/demo-motor-001.json"
        );
    }

    function assertSeededComponent(
        BikeNftLocalFixture.Deployment memory deployment,
        address owner,
        string memory serialNumber,
        string memory tokenURI_
    ) private view {
        IBicycleComponentManagerView.ComponentView memory component = deployment.manager.componentBySerial(serialNumber);

        assertTrue(component.exists, "seeded component should have a manager record");
        assertEq(
            component.tokenContract, address(deployment.components), "seeded component should use default collection"
        );
        assertEq(component.owner, owner, "seeded component owner mismatch");
        assertEq(component.registrar, owner, "seeded component registrar mismatch");
        assertEq(uint8(component.status), uint8(IBicycleComponentManagerView.ComponentStatus.Active), "status mismatch");
        assertEq(component.tokenURI, tokenURI_, "manager token URI mismatch");
        assertEq(deployment.components.ownerOf(component.tokenId), owner, "NFT owner mismatch");
        assertEq(deployment.components.tokenURI(component.tokenId), tokenURI_, "NFT token URI mismatch");
    }
}
