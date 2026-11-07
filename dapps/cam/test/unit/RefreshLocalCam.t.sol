pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {RefreshLocalCam} from "../../script/RefreshLocalCam.s.sol";
import {CamRoot} from "../../src/CamRoot.sol";

contract RefreshLocalCamHarness is RefreshLocalCam {
    function refreshFixture(string memory deploymentPath, string memory manifestPath, string memory expectedURI)
        external
    {
        _refresh(deploymentPath, manifestPath, expectedURI);
    }
}

contract RefreshLocalCamTest is Test {
    uint256 private constant FIXTURE_KEY = 0xbabababababababababababababababababababababababababababababababa;
    string private constant URI = "http://127.0.0.1:5194/cam/main.json";
    CamRoot private root;
    RefreshLocalCamHarness private refresh;

    function setUp() external {
        vm.chainId(31337);
        root = new CamRoot(vm.addr(FIXTURE_KEY), URI, bytes32(uint256(1)));
        vm.prank(vm.addr(FIXTURE_KEY));
        root.setContractAddress("Business", address(123));
        refresh = new RefreshLocalCamHarness();
    }

    function deployment(string memory name) private returns (string memory path) {
        path = string.concat("/tmp/local-cam-refresh/", name, ".json");
        vm.createDir("/tmp/local-cam-refresh", true);
        string memory document = string.concat(
            '{"chain":31337,"transactions":[{"transactionType":"CREATE","contractName":"CamRoot","contractAddress":"',
            vm.toString(address(root)),
            "\",\"arguments\":[\"",
            vm.toString(vm.addr(FIXTURE_KEY)),
            "\",\"",
            URI,
            "\",\"0x01\"]}]}"
        );
        vm.writeFile(path, document);
    }

    function testRefreshPreservesContractsAndSkipsUnchangedPublication() external {
        string memory path = deployment("unchanged");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        assertEq(root.camManifest().sha256Digest, sha256(vm.readFileBinary("pay-to-play/cam/main.json")));
        assertEq(root.camManifest().uri, URI);
        assertEq(root.contractAddress("Business"), address(123));
        assertEq(root.owner(), vm.addr(FIXTURE_KEY));
        vm.recordLogs();
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function testRejectsNonFixtureChainAndChangedAuthorityOrURI() external {
        string memory path = deployment("guards");
        vm.chainId(43113);
        vm.expectRevert("CAM refresh requires local fixture chain 31337");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        vm.chainId(31337);
        assertEq(root.camManifest().uri, URI);
        assertEq(root.camManifest().sha256Digest, bytes32(uint256(1)));
        vm.expectRevert("Fixture origin changed");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", "http://127.0.0.1:5195/cam/main.json");
        assertEq(root.camManifest().uri, URI);
        assertEq(root.camManifest().sha256Digest, bytes32(uint256(1)));
        vm.prank(vm.addr(FIXTURE_KEY));
        root.transferOwnership(address(123));
        vm.prank(address(123));
        root.acceptOwnership();
        vm.expectRevert("CAM root is not owned by the public fixture account");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
    }

    function testChangedLiveManifestUriIsRejectedSeparatelyFromExpectedOrigin() external {
        string memory path = deployment("live-drift");
        vm.prank(vm.addr(FIXTURE_KEY));
        root.setCam("http://127.0.0.1:5195/cam/main.json", bytes32(uint256(2)));
        assertEq(root.owner(), vm.addr(FIXTURE_KEY));
        vm.expectRevert("CAM manifest URI changed");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        assertEq(root.camManifest().sha256Digest, bytes32(uint256(2)));
    }

    function testInterleavedExpectedOriginsDoNotLeakAcrossRefreshCalls() external {
        string memory path = deployment("interleaved");
        vm.expectRevert("Fixture origin changed");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", "http://127.0.0.1:5195/cam/main.json");
        assertEq(root.camManifest().sha256Digest, bytes32(uint256(1)));

        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        bytes32 published = sha256(vm.readFileBinary("pay-to-play/cam/main.json"));
        assertEq(root.camManifest().sha256Digest, published);

        vm.expectRevert("Fixture origin changed");
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", "http://127.0.0.1:5195/cam/main.json");
        vm.recordLogs();
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        assertEq(vm.getRecordedLogs().length, 0);
        assertEq(root.camManifest().sha256Digest, published);
    }

    function testReadsDeploymentLargerThanACommandLineArgument() external {
        string memory path = deployment("large");
        bytes memory document = vm.readFileBinary(path);
        bytes memory padded = new bytes(document.length + 140000);
        for (uint256 i; i < padded.length; ++i) {
            padded[i] = i < document.length ? document[i] : bytes1(" ");
        }
        vm.writeFile(path, string(padded));
        refresh.refreshFixture(path, "pay-to-play/cam/main.json", URI);
        assertEq(root.camManifest().sha256Digest, sha256(vm.readFileBinary("pay-to-play/cam/main.json")));
    }
}
