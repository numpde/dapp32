pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";
import {DeployPayToPlayRelease} from "../../script/DeployPayToPlayRelease.s.sol";
import {PayToPlayReleaseVerifier} from "../../script/PayToPlayReleaseVerifier.sol";

contract PayToPlayReleaseHarness is DeployPayToPlayRelease, PayToPlayReleaseVerifier {
    function parse(string memory json) external view returns (ReleasePlan memory) {
        return _parsePlan(json);
    }

    function matchInputs(ReleasePlan memory plan) external view {
        _requireOperatorInputs(plan);
    }

    function validate(ReleasePlan memory plan) external view {
        _validatePlan(plan);
    }

    function deploy(ReleasePlan memory plan) external returns (CamRoot root, PayToPlay payments) {
        _validatePlan(plan);
        return _deploy(plan, address(this));
    }

    function verify(Artifact memory artifact, string memory source) external {
        verifyArtifact(artifact, source);
    }
}

contract PayToPlayReleaseTest is Test {
    string private constant SOURCE = "0123456789abcdef0123456789abcdef01234567";
    string private constant URI = "https://example.test/pay-to-play/cam/main.json";
    address private constant ROOT_OWNER = address(0xBEEF);
    address private constant ADMIN = address(0xCAFE);
    PayToPlayReleaseHarness private harness;

    function setUp() external {
        vm.chainId(11155111);
        harness = new PayToPlayReleaseHarness();
    }

    function testDeploymentSeparatesAuthoritiesAndCreatesOnlyReservedChannel() external {
        DeployPayToPlayRelease.ReleasePlan memory plan = _plan(60);
        (CamRoot root, PayToPlay payments) = harness.deploy(plan);
        assertEq(root.owner(), address(harness));
        assertEq(root.pendingOwner(), ROOT_OWNER);
        assertEq(payments.owner(), address(harness));
        assertEq(payments.pendingOwner(), ADMIN);
        assertEq(root.contractAddress("PayToPlay"), address(payments));
        assertEq(payments.channelCount(), 1);
        assertEq(payments.channel(0).claimPeriod, 60);
        assertEq(payments.channel(0).payee, address(0));
    }

    function testAcceptsZeroAndMaximumWait() external {
        harness.validate(_plan(0));
        harness.validate(_plan(30 days));
    }

    function testZeroCamHashDeploysAndVerifiesWithoutMaskingDigestDrift() external {
        DeployPayToPlayRelease.ReleasePlan memory plan = _plan(60);
        plan.camHash = bytes32(0);
        (CamRoot root, PayToPlay payments) = harness.deploy(plan);
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        vm.prank(ADMIN);
        payments.acceptOwnership();
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        artifact.camHash = bytes32(0);
        harness.verify(artifact, SOURCE);
        vm.prank(ROOT_OWNER);
        root.setCam(URI, bytes32(uint256(1)));
        _expectVerification("CAM digest");
        harness.verify(artifact, SOURCE);
    }

    function testRejectsTooLongWaitBeforeDeployment() external {
        DeployPayToPlayRelease.ReleasePlan memory plan = _plan(30 days + 1);
        vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "nullClaimPeriod"));
        harness.validate(plan);
    }

    function testRejectsWrongChainSourceAndAuthority() external {
        DeployPayToPlayRelease.ReleasePlan memory plan = _plan(60);
        plan.expectedChainId = 1;
        vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "expectedChainId"));
        harness.validate(plan);
        plan = _plan(60);
        plan.camHash ^= bytes32(uint256(1));
        vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "camHash"));
        harness.validate(plan);
        plan = _plan(60);
        plan.intendedPaymentAdmin = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "intendedPaymentAdmin")
        );
        harness.validate(plan);
    }

    function testBothOwnershipHandoffsAreRequired() external {
        (CamRoot root, PayToPlay payments) = harness.deploy(_plan(60));
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        _expectVerification("CamRoot ownership");
        harness.verify(artifact, SOURCE);
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        _expectVerification("PayToPlay ownership");
        harness.verify(artifact, SOURCE);
        vm.prank(ADMIN);
        payments.acceptOwnership();
        harness.verify(artifact, SOURCE);
    }

    function testAddressDependentRuntimeDoesNotInvalidateGenuineReleases() external {
        (CamRoot root, PayToPlay payments) = _accepted(0);
        (CamRoot otherRoot, PayToPlay otherPayments) = _accepted(0);
        assertNotEq(address(payments).codehash, address(otherPayments).codehash);
        harness.verify(_artifact(root, payments, 0), SOURCE);
        harness.verify(_artifact(otherRoot, otherPayments, 0), SOURCE);
    }

    function testSourceProofRejectsChangedConstructorOrBytecodeEvenWithMatchingRuntimeHash() external {
        (CamRoot root, PayToPlay payments) = _accepted(60);
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        artifact.payToPlayCreationInputHash =
            keccak256(abi.encodePacked(type(PayToPlay).creationCode, abi.encode(address(123), uint64(60))));
        _expectVerification("PayToPlay creation source");
        harness.verify(artifact, SOURCE);
        artifact.payToPlayCreationInputHash =
            keccak256(abi.encodePacked(type(PayToPlay).creationCode, abi.encode(address(harness), uint64(61))));
        _expectVerification("PayToPlay creation source");
        harness.verify(artifact, SOURCE);
        artifact.payToPlayCreationInputHash = keccak256(hex"60006000");
        _expectVerification("PayToPlay creation source");
        harness.verify(artifact, SOURCE);
    }

    function testNormalUseDoesNotInvalidateReleaseVerification() external {
        (CamRoot root, PayToPlay payments) = _accepted(60);
        vm.prank(ADMIN);
        uint256 id = payments.createChannel(address(0x123), 20);
        vm.deal(address(this), 1 ether);
        payments.fund{value: 1 ether}(id, 1 ether);
        harness.verify(_artifact(root, payments, 60), SOURCE);
    }

    function testRejectsBindingRuntimeAndManifestDrift() external {
        (CamRoot root, PayToPlay payments) = _accepted(60);
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        vm.prank(ROOT_OWNER);
        root.setContractAddress("PayToPlay", address(123));
        _expectVerification("PayToPlay binding");
        harness.verify(artifact, SOURCE);
        vm.prank(ROOT_OWNER);
        root.setContractAddress("PayToPlay", address(payments));
        artifact.payToPlayCodeHash = bytes32(uint256(1));
        _expectVerification("PayToPlay runtime hash");
        harness.verify(artifact, SOURCE);
        artifact = _artifact(root, payments, 60);
        artifact.camHash = bytes32(uint256(1));
        _expectVerification("CAM digest");
        harness.verify(artifact, SOURCE);
    }

    function testRejectsRootPendingAfterPaymentAdminAccepts() external {
        (CamRoot root, PayToPlay payments) = harness.deploy(_plan(60));
        vm.prank(ADMIN);
        payments.acceptOwnership();
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        _expectVerification("CamRoot ownership");
        harness.verify(artifact, SOURCE);
    }

    function testFuzzRejectsNewPendingOwnershipTransfer(bool payment) external {
        (CamRoot root, PayToPlay payments) = _accepted(60);
        if (payment) {
            vm.prank(ADMIN);
            payments.transferOwnership(address(123));
        } else {
            vm.prank(ROOT_OWNER);
            root.transferOwnership(address(123));
        }
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        if (payment) _expectVerification("PayToPlay ownership");
        else _expectVerification("CamRoot ownership");
        harness.verify(artifact, SOURCE);
    }

    function testParsesZeroWaitAndRejectsWrongSchemaAndOversizedWait() external {
        DeployPayToPlayRelease.ReleasePlan memory plan = harness.parse(_json("0"));
        assertEq(plan.nullClaimPeriod, 0);
        assertEq(plan.intendedCamRootOwner, ROOT_OWNER);
        assertEq(plan.intendedPaymentAdmin, ADMIN);
        vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "schema"));
        harness.parse('{"schema":"wrong"}');
        string memory tooLarge = _json("18446744073709551616");
        vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.InvalidReleasePlan.selector, "nullClaimPeriod"));
        harness.parse(tooLarge);
    }

    function testOperatorInputsMustEachMatchThePlan() external {
        string[6] memory names = [
            "SOURCE_COMMIT",
            "EXPECTED_CHAIN_ID",
            "CAM_URI",
            "INTENDED_CAM_ROOT_OWNER",
            "INTENDED_PAYMENT_ADMIN",
            "NULL_CLAIM_PERIOD"
        ];
        string[6] memory fields = [
            "sourceCommit",
            "expectedChainId",
            "camURI",
            "intendedCamRootOwner",
            "intendedPaymentAdmin",
            "nullClaimPeriod"
        ];
        string[6] memory values = [SOURCE, "11155111", URI, vm.toString(ROOT_OWNER), vm.toString(ADMIN), "60"];
        string[6] memory wrong = [
            string("ffffffffffffffffffffffffffffffffffffffff"),
            "1",
            "https://other.test/main.json",
            vm.toString(address(123)),
            vm.toString(address(123)),
            "61"
        ];
        for (uint256 i; i < names.length; i++) {
            vm.setEnv(string.concat("PAY_TO_PLAY_RELEASE_", names[i]), values[i]);
        }
        DeployPayToPlayRelease.ReleasePlan memory plan = _plan(60);
        harness.matchInputs(plan);
        for (uint256 i; i < names.length; i++) {
            string memory name = string.concat("PAY_TO_PLAY_RELEASE_", names[i]);
            vm.setEnv(name, wrong[i]);
            vm.expectRevert(abi.encodeWithSelector(DeployPayToPlayRelease.OperatorInputMismatch.selector, fields[i]));
            harness.matchInputs(plan);
            vm.setEnv(name, values[i]);
        }
    }

    function _json(string memory period) private view returns (string memory) {
        return string.concat(
            '{"schema":"pay-to-play.release-plan.v1","sourceCommit":"',
            SOURCE,
            '","expectedChainId":11155111,"camURI":"',
            URI,
            '","camHash":"',
            vm.toString(sha256("manifest")),
            '","intendedCamRootOwner":"',
            vm.toString(ROOT_OWNER),
            '","intendedPaymentAdmin":"',
            vm.toString(ADMIN),
            '","nullClaimPeriod":',
            period,
            "}"
        );
    }

    function _expectVerification(string memory field) private {
        vm.expectRevert(abi.encodeWithSelector(PayToPlayReleaseVerifier.ReleaseVerificationFailed.selector, field));
    }

    function _accepted(uint64 period) private returns (CamRoot root, PayToPlay payments) {
        (root, payments) = harness.deploy(_plan(period));
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        vm.prank(ADMIN);
        payments.acceptOwnership();
    }

    function _plan(uint64 period) private view returns (DeployPayToPlayRelease.ReleasePlan memory) {
        return DeployPayToPlayRelease.ReleasePlan({
            sourceCommit: SOURCE,
            expectedChainId: block.chainid,
            camURI: URI,
            camHash: sha256(vm.readFileBinary("pay-to-play/cam/main.json")),
            intendedCamRootOwner: ROOT_OWNER,
            intendedPaymentAdmin: ADMIN,
            nullClaimPeriod: period
        });
    }

    function _artifact(CamRoot root, PayToPlay payments, uint64 period)
        private
        view
        returns (PayToPlayReleaseVerifier.Artifact memory)
    {
        return PayToPlayReleaseVerifier.Artifact({
            sourceCommit: SOURCE,
            chainId: block.chainid,
            camURI: URI,
            camHash: sha256(vm.readFileBinary("pay-to-play/cam/main.json")),
            intendedCamRootOwner: ROOT_OWNER,
            intendedPaymentAdmin: ADMIN,
            nullClaimPeriod: period,
            deployer: address(harness),
            camRoot: address(root),
            payToPlay: address(payments),
            camRootCodeHash: address(root).codehash,
            payToPlayCodeHash: address(payments).codehash,
            payToPlayCreationInputHash: keccak256(
                abi.encodePacked(type(PayToPlay).creationCode, abi.encode(address(harness), period))
            )
        });
    }
}
