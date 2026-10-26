pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayUI} from "../../src/PayToPlayUI.sol";
import {PayToPlayContractDeployment} from "../../script/PayToPlayContractDeployment.sol";
import {PayToPlayReleaseVerifier} from "../../script/PayToPlayReleaseVerifier.sol";

contract PayToPlayReleaseHarness is PayToPlayContractDeployment, PayToPlayReleaseVerifier {
    function prepareUI(address payments) external returns (PayToPlayUI) {
        return deployPayToPlayUI(payments);
    }

    function activateUI(CamRoot root, PayToPlayUI ui) external {
        bindPayToPlayUI(root, ui);
    }

    function sourceUICodeHash(address payments) external returns (bytes32) {
        return payToPlayUISourceCodeHash(payments);
    }

    function createPayments(uint64 period) external returns (PayToPlay) {
        return deployPayToPlayContract(address(this), period);
    }

    // Assemble historical verifier evidence in a fixture; no production publication runtime is involved.
    function deployFixture(uint64 period, bytes32 hash, address rootOwner, address admin)
        external
        returns (CamRoot root, PayToPlay payments)
    {
        payments = deployPayToPlayContract(address(this), period);
        nominatePayToPlayAdmin(payments, admin, address(this));
        PayToPlayUI ui = deployPayToPlayUI(address(payments));
        root = new CamRoot(address(this), "https://example.test/pay-to-play/cam/main.json", hash);
        root.setContractAddress("PayToPlay", address(payments));
        bindPayToPlayUI(root, ui);
        if (rootOwner != address(this)) root.transferOwnership(rootOwner);
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
        (CamRoot root, PayToPlay payments) = _deploy(60);
        assertEq(root.owner(), address(harness));
        assertEq(root.pendingOwner(), ROOT_OWNER);
        assertEq(payments.owner(), address(harness));
        assertEq(payments.pendingOwner(), ADMIN);
        assertEq(root.contractAddress("PayToPlay"), address(payments));
        address ui = root.contractAddress("PayToPlayUI");
        assertTrue(ui != address(0), "a fresh deployment must bind its read-only signing projection");
        assertEq(address(PayToPlayUI(ui).payments()), address(payments));
        assertEq(payments.channelCount(), 1);
        assertEq(payments.channel(0).claimPeriod, 60);
        assertEq(payments.channel(0).payee, address(0));
    }

    function testReplacementUIIsInactiveUntilExplicitBinding() external {
        (CamRoot root, PayToPlay payments) = _deploy(60);
        address previousUI = root.contractAddress("PayToPlayUI");
        PayToPlayUI replacement = harness.prepareUI(address(payments));
        assertEq(root.contractAddress("PayToPlayUI"), previousUI);
        assertEq(address(replacement.payments()), address(payments));
        assertEq(harness.sourceUICodeHash(address(payments)), address(replacement).codehash);
        harness.activateUI(root, replacement);
        assertEq(root.contractAddress("PayToPlayUI"), address(replacement));
        assertEq(root.contractAddress("PayToPlay"), address(payments));
        assertEq(root.owner(), address(harness));
        assertEq(root.pendingOwner(), ROOT_OWNER);
        assertEq(payments.channelCount(), 1);
        vm.etch(address(replacement), hex"00");
        assertNotEq(harness.sourceUICodeHash(address(payments)), address(replacement).codehash);
    }

    function testVerifierRejectsSubstitutedSigningProjectionEvidence() external {
        (CamRoot root, PayToPlay payments) = _deploy(60);
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        vm.prank(ADMIN);
        payments.acceptOwnership();
        PayToPlayReleaseVerifier.Artifact memory artifact = _artifact(root, payments, 60);
        harness.verify(artifact, SOURCE);
        artifact.payToPlayUICreationInputHash ^= bytes32(uint256(1));
        _expectVerification("PayToPlayUI creation source");
        harness.verify(artifact, SOURCE);
        artifact = _artifact(root, payments, 60);
        artifact.payToPlayUICodeHash ^= bytes32(uint256(1));
        _expectVerification("PayToPlayUI runtime hash");
        harness.verify(artifact, SOURCE);
        artifact = _artifact(root, payments, 60);
        PayToPlay otherPayments = new PayToPlay(address(this), 60);
        PayToPlayUI otherUI = new PayToPlayUI(address(otherPayments));
        vm.prank(ROOT_OWNER);
        root.setContractAddress("PayToPlayUI", address(otherUI));
        _expectVerification("PayToPlayUI binding");
        harness.verify(artifact, SOURCE);
        artifact = _artifact(root, payments, 60);
        _expectVerification("PayToPlayUI payment contract");
        harness.verify(artifact, SOURCE);
    }

    function testAcceptsZeroAndMaximumWait() external {
        assertEq(harness.createPayments(0).channel(0).claimPeriod, 0);
        assertEq(harness.createPayments(30 days).channel(0).claimPeriod, 30 days);
    }

    function testZeroCamHashDeploysAndVerifiesWithoutMaskingDigestDrift() external {
        (CamRoot root, PayToPlay payments) = harness.deployFixture(60, bytes32(0), ROOT_OWNER, ADMIN);
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

    function testBusinessConstructionRejectsTooLongWait() external {
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ClaimPeriodTooLong.selector, uint64(30 days + 1)));
        harness.createPayments(30 days + 1);
    }

    function testBothOwnershipHandoffsAreRequired() external {
        (CamRoot root, PayToPlay payments) = _deploy(60);
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
        uint256 id = payments.createChannel(address(0x123), address(this), 20);
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
        (CamRoot root, PayToPlay payments) = _deploy(60);
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

    function _expectVerification(string memory field) private {
        vm.expectRevert(abi.encodeWithSelector(PayToPlayReleaseVerifier.ReleaseVerificationFailed.selector, field));
    }

    function _accepted(uint64 period) private returns (CamRoot root, PayToPlay payments) {
        (root, payments) = _deploy(period);
        vm.prank(ROOT_OWNER);
        root.acceptOwnership();
        vm.prank(ADMIN);
        payments.acceptOwnership();
    }

    function _deploy(uint64 period) private returns (CamRoot root, PayToPlay payments) {
        return harness.deployFixture(period, sha256(vm.readFileBinary("pay-to-play/cam/main.json")), ROOT_OWNER, ADMIN);
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
            payToPlayUI: root.contractAddress("PayToPlayUI"),
            payToPlayUICodeHash: root.contractAddress("PayToPlayUI").codehash,
            payToPlayUICreationInputHash: keccak256(
                abi.encodePacked(type(PayToPlayUI).creationCode, abi.encode(address(payments)))
            ),
            camRootCodeHash: address(root).codehash,
            payToPlayCodeHash: address(payments).codehash,
            payToPlayCreationInputHash: keccak256(
                abi.encodePacked(type(PayToPlay).creationCode, abi.encode(address(harness), period))
            )
        });
    }
}
