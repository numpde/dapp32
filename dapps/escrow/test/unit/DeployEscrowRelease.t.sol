pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {DeployEscrowRelease} from "../../script/DeployEscrowRelease.s.sol";

contract DeployEscrowReleaseHarness is DeployEscrowRelease {
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
    string private constant CAM_ROOT_TEXT = "{\"cam\":\"1.1.0\"}\n";
    uint256 private constant RELEASE_CHAIN_ID = 11_155_111;
    address private constant FINAL_OWNER = address(0xBEEF);

    DeployEscrowReleaseHarness private harness;

    function setUp() external {
        vm.chainId(RELEASE_CHAIN_ID);
        vm.setEnv("ESCROW_RELEASE_CAM_ROOT_TEXT", CAM_ROOT_TEXT);
        harness = new DeployEscrowReleaseHarness();
    }

    function testAcceptsPlanBoundToExactCamRootText() external view {
        harness.validate(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, keccak256(bytes(CAM_ROOT_TEXT)), FINAL_OWNER);
    }

    function testRejectsCamHashNotBoundToExactCamRootText() external {
        bytes32 plannedHash = keccak256("other-cam-root");
        bytes32 sourceHash = keccak256(bytes(CAM_ROOT_TEXT));

        vm.expectRevert(
            abi.encodeWithSelector(DeployEscrowRelease.CamHashSourceMismatch.selector, plannedHash, sourceHash)
        );
        harness.validate(SOURCE_COMMIT, RELEASE_CHAIN_ID, CAM_URI, plannedHash, FINAL_OWNER);
    }

    function testRejectsOperatorChainMismatch() external {
        vm.expectRevert(
            abi.encodeWithSelector(DeployEscrowRelease.ChainIdMismatch.selector, RELEASE_CHAIN_ID + 1, RELEASE_CHAIN_ID)
        );
        harness.validate(
            SOURCE_COMMIT,
            RELEASE_CHAIN_ID + 1,
            CAM_URI,
            keccak256(bytes(CAM_ROOT_TEXT)),
            FINAL_OWNER
        );
    }
}
