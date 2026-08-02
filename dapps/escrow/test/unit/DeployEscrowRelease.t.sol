pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {DeployEscrowRelease} from "../../script/DeployEscrowRelease.s.sol";

contract DeployEscrowReleaseHarness is DeployEscrowRelease {
    function parsePlan(string memory json) external view returns (ReleasePlan memory) {
        return _parsePlan(json);
    }

    function requireOperatorInputs(
        string memory sourceCommit,
        uint256 expectedChainId,
        string memory camURI,
        bytes32 camHash,
        address intendedCamRootOwner
    ) external view {
        ReleasePlan memory plan = ReleasePlan({
            sourceCommit: sourceCommit,
            expectedChainId: expectedChainId,
            camURI: camURI,
            camHash: camHash,
            intendedCamRootOwner: intendedCamRootOwner
        });
        _requireOperatorInputs(plan);
    }

    function validate(
        string memory sourceCommit,
        uint256 expectedChainId,
        string memory camURI,
        bytes32 camHash,
        address intendedCamRootOwner
    ) external view {
        ReleasePlan memory plan = ReleasePlan({
            sourceCommit: sourceCommit,
            expectedChainId: expectedChainId,
            camURI: camURI,
            camHash: camHash,
            intendedCamRootOwner: intendedCamRootOwner
        });
        _validatePlan(plan);
    }
}

contract DeployEscrowReleaseTest is Test {
    string private constant SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567";
    string private constant CAM_URI = "https://example.test/escrow/cam/main.json";
    bytes32 private constant CAM_ROOT_HASH = 0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66;
    uint256 private constant RELEASE_CHAIN_ID = 11_155_111;
    address private constant FINAL_OWNER = address(0xBEEF);
    string private constant PLAN_JSON =
        '{"schema":"escrow.release-plan.v1","sourceCommit":"0123456789abcdef0123456789abcdef01234567","expectedChainId":11155111,"camURI":"https://example.test/escrow/cam/main.json","camHash":"0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66","intendedCamRootOwner":"0x000000000000000000000000000000000000bEEF"}';

    DeployEscrowReleaseHarness private harness;

    function setUp() external {
        vm.chainId(RELEASE_CHAIN_ID);
        vm.setEnv("ESCROW_RELEASE_SOURCE_COMMIT", SOURCE_COMMIT);
        vm.setEnv("ESCROW_RELEASE_EXPECTED_CHAIN_ID", vm.toString(RELEASE_CHAIN_ID));
        vm.setEnv("ESCROW_RELEASE_CAM_URI", CAM_URI);
        vm.setEnv("ESCROW_RELEASE_CAM_ROOT_OWNER", vm.toString(FINAL_OWNER));
        harness = new DeployEscrowReleaseHarness();
    }

    function testAcceptsOperatorAuthorizedInputs() external view {
        harness.requireOperatorInputs(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, CAM_ROOT_HASH, FINAL_OWNER);
    }

    function testParsesCanonicalReleasePlan() external view {
        DeployEscrowRelease.ReleasePlan memory plan = harness.parsePlan(PLAN_JSON);
        assertEq(plan.sourceCommit, SOURCE_COMMIT);
        assertEq(plan.expectedChainId, RELEASE_CHAIN_ID);
        assertEq(plan.camURI, CAM_URI);
        assertEq(plan.camHash, CAM_ROOT_HASH);
        assertEq(plan.intendedCamRootOwner, FINAL_OWNER);
    }

    function testRejectsWrongPlanSchema() external {
        string memory json =
            '{"schema":"other","sourceCommit":"0123456789abcdef0123456789abcdef01234567","expectedChainId":11155111,"camURI":"https://example.test/escrow/cam/main.json","camHash":"0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66","intendedCamRootOwner":"0x000000000000000000000000000000000000bEEF"}';
        vm.expectRevert(abi.encodeWithSelector(DeployEscrowRelease.InvalidReleasePlanSchema.selector, "other"));
        harness.parsePlan(json);
    }

    function testRejectsMalformedPlanJson() external {
        vm.expectRevert();
        harness.parsePlan("{");
    }

    function testRejectsOperatorSourceCommitMismatch() external {
        vm.expectRevert(abi.encodeWithSelector(DeployEscrowRelease.OperatorInputMismatch.selector, "sourceCommit"));
        harness.requireOperatorInputs(
            "1123456789abcdef0123456789abcdef01234567", RELEASE_CHAIN_ID, CAM_URI, CAM_ROOT_HASH, FINAL_OWNER
        );
    }

    function testRejectsOperatorExpectedChainMismatch() external {
        vm.expectRevert(abi.encodeWithSelector(DeployEscrowRelease.OperatorInputMismatch.selector, "expectedChainId"));
        harness.requireOperatorInputs(SOURCE_COMMIT, RELEASE_CHAIN_ID + 1, CAM_URI, CAM_ROOT_HASH, FINAL_OWNER);
    }

    function testRejectsOperatorCamUriMismatch() external {
        vm.expectRevert(abi.encodeWithSelector(DeployEscrowRelease.OperatorInputMismatch.selector, "camURI"));
        harness.requireOperatorInputs(
            SOURCE_COMMIT, RELEASE_CHAIN_ID, "https://other.test/main.json", CAM_ROOT_HASH, FINAL_OWNER
        );
    }

    function testRejectsOperatorOwnerMismatch() external {
        vm.expectRevert(
            abi.encodeWithSelector(DeployEscrowRelease.OperatorInputMismatch.selector, "intendedCamRootOwner")
        );
        harness.requireOperatorInputs(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, CAM_ROOT_HASH, address(0xCAFE));
    }

    function testAcceptsPlanBoundToExactCamRootBytes() external view {
        harness.validate(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, CAM_ROOT_HASH, FINAL_OWNER);
    }

    function testRejectsCamHashNotBoundToExactCamRootBytes() external {
        bytes32 plannedHash = keccak256("other-cam-root");
        bytes32 sourceHash = CAM_ROOT_HASH;

        vm.expectRevert(
            abi.encodeWithSelector(DeployEscrowRelease.CamHashSourceMismatch.selector, plannedHash, sourceHash)
        );
        harness.validate(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, plannedHash, FINAL_OWNER);
    }

    function testRejectsOperatorChainMismatch() external {
        vm.expectRevert(
            abi.encodeWithSelector(DeployEscrowRelease.ChainIdMismatch.selector, RELEASE_CHAIN_ID + 1, RELEASE_CHAIN_ID)
        );
        harness.validate(SOURCE_COMMIT, RELEASE_CHAIN_ID + 1, CAM_URI, CAM_ROOT_HASH, FINAL_OWNER);
    }
}
