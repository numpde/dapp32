pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {DeployBikeNftRelease} from "../../../script/DeployBikeNftRelease.s.sol";

contract DeployBikeNftReleaseHarness is DeployBikeNftRelease {
    function parsePlan(string memory json) external view returns (ReleasePlan memory) {
        return _parsePlan(json);
    }

    function validatePlan(ReleasePlan memory plan, address deployer) external view {
        _validatePlan(plan, deployer);
    }

    function requireOperatorInputs(ReleasePlan memory plan, OperatorInputs memory inputs) external pure {
        _requireOperatorInputs(plan, inputs);
    }

    function readDelay(string memory json, string memory field) external view returns (uint48) {
        return _readDelay(json, field);
    }
}

contract DeployBikeNftReleaseTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/bike/v1/main.json";
    bytes32 private constant CAM_HASH = 0x57fa120882de1530d9b48f00e8d3e780edd42c2159378b69ce86996bfb279961;
    uint256 private constant CHAIN_ID = 11_155_111;
    address private constant CAM_ROOT_OWNER = address(0x11);
    address private constant COMPONENTS_ADMIN = address(0x12);
    address private constant COMPONENTS_PAUSER = address(0x13);
    address private constant COMPONENTS_CONFIGURER = address(0x14);
    address private constant MANAGER_ADMIN = address(0x15);
    address private constant MANAGER_PAUSER = address(0x16);
    address private constant MANAGER_CONFIGURER = address(0x17);
    address private constant REGISTRAR_ONE = address(0x18);
    address private constant REGISTRAR_TWO = address(0x19);
    string private constant PLAN_JSON =
        '{"schema":"bike-nft.release-plan.v1","sourceCommit":"0123456789abcdef0123456789abcdef01234567","expectedChainId":11155111,"camURI":"https://example.test/bike/v1/main.json","camHash":"0x57fa120882de1530d9b48f00e8d3e780edd42c2159378b69ce86996bfb279961","intendedCamRootOwner":"0x0000000000000000000000000000000000000011","tokenName":"Bicycle Components","tokenSymbol":"BIKE","baseTokenURI":"https://example.test/bike/tokens/","collectionURI":"https://example.test/bike/collection.json","intendedComponentsAdmin":"0x0000000000000000000000000000000000000012","componentsAdminDelay":86400,"componentsPauser":"0x0000000000000000000000000000000000000013","componentsConfigurer":"0x0000000000000000000000000000000000000014","intendedManagerAdmin":"0x0000000000000000000000000000000000000015","managerAdminDelay":86400,"managerPauser":"0x0000000000000000000000000000000000000016","managerConfigurer":"0x0000000000000000000000000000000000000017","registrars":["0x0000000000000000000000000000000000000018","0x0000000000000000000000000000000000000019"]}';

    DeployBikeNftReleaseHarness private harness;

    function setUp() external {
        vm.chainId(CHAIN_ID);
        harness = new DeployBikeNftReleaseHarness();
    }

    function testParsesAndValidatesCanonicalPlan() external view {
        DeployBikeNftRelease.ReleasePlan memory plan = harness.parsePlan(PLAN_JSON);
        assertEq(plan.sourceCommit, SOURCE_COMMIT);
        assertEq(plan.expectedChainId, CHAIN_ID);
        assertEq(plan.camHash, CAM_HASH);
        assertEq(plan.componentsAdminDelay, 86_400);
        assertEq(plan.managerAdminDelay, 86_400);
        assertEq(plan.registrars.length, 2);
        assertEq(plan.registrars[0], REGISTRAR_ONE);
        assertEq(plan.registrars[1], REGISTRAR_TWO);
        harness.requireOperatorInputs(plan, _operatorInputs(plan));
        harness.validatePlan(plan, address(0x99));
    }

    function testRejectsEveryOperatorFieldMismatch() external {
        DeployBikeNftRelease.ReleasePlan memory plan = harness.parsePlan(PLAN_JSON);
        DeployBikeNftRelease.OperatorInputs memory inputs = _operatorInputs(plan);

        inputs.sourceCommit = "other";
        _expectOperatorMismatch(plan, inputs, "sourceCommit");
        inputs.sourceCommit = plan.sourceCommit;
        inputs.expectedChainId++;
        _expectOperatorMismatch(plan, inputs, "expectedChainId");
        inputs.expectedChainId = plan.expectedChainId;
        inputs.camURI = "other";
        _expectOperatorMismatch(plan, inputs, "camURI");
        inputs.camURI = plan.camURI;
        inputs.intendedCamRootOwner = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "intendedCamRootOwner");
        inputs.intendedCamRootOwner = plan.intendedCamRootOwner;
        inputs.tokenName = "other";
        _expectOperatorMismatch(plan, inputs, "tokenName");
        inputs.tokenName = plan.tokenName;
        inputs.tokenSymbol = "other";
        _expectOperatorMismatch(plan, inputs, "tokenSymbol");
        inputs.tokenSymbol = plan.tokenSymbol;
        inputs.baseTokenURI = "other";
        _expectOperatorMismatch(plan, inputs, "baseTokenURI");
        inputs.baseTokenURI = plan.baseTokenURI;
        inputs.collectionURI = "other";
        _expectOperatorMismatch(plan, inputs, "collectionURI");
        inputs.collectionURI = plan.collectionURI;
        inputs.intendedComponentsAdmin = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "intendedComponentsAdmin");
        inputs.intendedComponentsAdmin = plan.intendedComponentsAdmin;
        inputs.componentsAdminDelay++;
        _expectOperatorMismatch(plan, inputs, "componentsAdminDelay");
        inputs.componentsAdminDelay = plan.componentsAdminDelay;
        inputs.componentsPauser = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "componentsPauser");
        inputs.componentsPauser = plan.componentsPauser;
        inputs.componentsConfigurer = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "componentsConfigurer");
        inputs.componentsConfigurer = plan.componentsConfigurer;
        inputs.intendedManagerAdmin = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "intendedManagerAdmin");
        inputs.intendedManagerAdmin = plan.intendedManagerAdmin;
        inputs.managerAdminDelay++;
        _expectOperatorMismatch(plan, inputs, "managerAdminDelay");
        inputs.managerAdminDelay = plan.managerAdminDelay;
        inputs.managerPauser = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "managerPauser");
        inputs.managerPauser = plan.managerPauser;
        inputs.managerConfigurer = address(0xAA);
        _expectOperatorMismatch(plan, inputs, "managerConfigurer");
        inputs.managerConfigurer = plan.managerConfigurer;

        inputs.registrars[0] = REGISTRAR_TWO;
        inputs.registrars[1] = REGISTRAR_ONE;
        _expectOperatorMismatch(plan, inputs, "registrars");
        inputs.registrars[0] = REGISTRAR_ONE;
        inputs.registrars[1] = address(0x20);
        _expectOperatorMismatch(plan, inputs, "registrars");
    }

    function testRejectsWrongPlanSchema() external {
        vm.expectRevert(abi.encodeWithSelector(DeployBikeNftRelease.InvalidReleasePlanSchema.selector, "other"));
        harness.parsePlan('{"schema":"other"}');
    }

    function testRejectsMalformedPlanJson() external {
        vm.expectRevert();
        harness.parsePlan("{");
    }

    function testRejectsAdminDelayOverflow() external {
        uint256 overflow = uint256(type(uint48).max) + 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployBikeNftRelease.AdminDelayOutOfRange.selector, ".componentsAdminDelay", overflow
            )
        );
        harness.readDelay('{"componentsAdminDelay":281474976710656}', ".componentsAdminDelay");
    }

    function testRejectsDeployerAsFinalAuthority() external {
        DeployBikeNftRelease.ReleasePlan memory plan = harness.parsePlan(PLAN_JSON);
        vm.expectRevert(
            abi.encodeWithSelector(DeployBikeNftRelease.DeployerRetainsAuthority.selector, "intendedCamRootOwner")
        );
        harness.validatePlan(plan, CAM_ROOT_OWNER);
    }

    function _operatorInputs(DeployBikeNftRelease.ReleasePlan memory plan)
        private
        pure
        returns (DeployBikeNftRelease.OperatorInputs memory inputs)
    {
        inputs.sourceCommit = plan.sourceCommit;
        inputs.expectedChainId = plan.expectedChainId;
        inputs.camURI = plan.camURI;
        inputs.intendedCamRootOwner = plan.intendedCamRootOwner;
        inputs.tokenName = plan.tokenName;
        inputs.tokenSymbol = plan.tokenSymbol;
        inputs.baseTokenURI = plan.baseTokenURI;
        inputs.collectionURI = plan.collectionURI;
        inputs.intendedComponentsAdmin = plan.intendedComponentsAdmin;
        inputs.componentsAdminDelay = plan.componentsAdminDelay;
        inputs.componentsPauser = plan.componentsPauser;
        inputs.componentsConfigurer = plan.componentsConfigurer;
        inputs.intendedManagerAdmin = plan.intendedManagerAdmin;
        inputs.managerAdminDelay = plan.managerAdminDelay;
        inputs.managerPauser = plan.managerPauser;
        inputs.managerConfigurer = plan.managerConfigurer;
        inputs.registrars = new address[](plan.registrars.length);
        for (uint256 i = 0; i < plan.registrars.length; i++) {
            inputs.registrars[i] = plan.registrars[i];
        }
    }

    function _expectOperatorMismatch(
        DeployBikeNftRelease.ReleasePlan memory plan,
        DeployBikeNftRelease.OperatorInputs memory inputs,
        string memory field
    ) private {
        vm.expectRevert(abi.encodeWithSelector(DeployBikeNftRelease.OperatorInputMismatch.selector, field));
        harness.requireOperatorInputs(plan, inputs);
    }
}
