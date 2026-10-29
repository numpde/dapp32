pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {RefreshLocalCam} from "../../script/RefreshLocalCam.s.sol";
import {CamRoot} from "../../src/CamRoot.sol";

contract RefreshLocalCamTest is Test {
    uint256 private constant FIXTURE_KEY = 0xbabababababababababababababababababababababababababababababababa;
    string private constant URI = "http://127.0.0.1:5194/cam/main.json";
    CamRoot private root;
    RefreshLocalCam private refresh;

    function setUp() external {
        vm.chainId(31337);
        root = new CamRoot(vm.addr(FIXTURE_KEY), URI, bytes32(uint256(1)));
        vm.prank(vm.addr(FIXTURE_KEY));
        root.setContractAddress("Business", address(123));
        refresh = new RefreshLocalCam();
        vm.setEnv("CAM_URI", URI);
    }

    function deployment() private view returns (string memory) {
        return string.concat(
            '{"chain":31337,"transactions":[{"transactionType":"CREATE","contractName":"CamRoot","contractAddress":"',
            vm.toString(address(root)),
            "\",\"arguments\":[\"",
            vm.toString(vm.addr(FIXTURE_KEY)),
            "\",\"",
            URI,
            "\",\"0x01\"]}]}"
        );
    }

    function testRefreshPreservesContractsAndSkipsUnchangedPublication() external {
        refresh.run(deployment(), "pay-to-play/cam/main.json");
        assertEq(root.camManifest().sha256Digest, sha256(vm.readFileBinary("pay-to-play/cam/main.json")));
        assertEq(root.camManifest().uri, URI);
        assertEq(root.contractAddress("Business"), address(123));
        assertEq(root.owner(), vm.addr(FIXTURE_KEY));
        vm.recordLogs();
        refresh.run(deployment(), "pay-to-play/cam/main.json");
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function testRejectsNonFixtureChainAndChangedAuthorityOrURI() external {
        vm.chainId(43113);
        vm.expectRevert("CAM refresh requires local fixture chain 31337");
        refresh.run(deployment(), "pay-to-play/cam/main.json");
        vm.chainId(31337);
        vm.setEnv("CAM_URI", "http://127.0.0.1:5195/cam/main.json");
        vm.expectRevert("Fixture origin changed");
        refresh.run(deployment(), "pay-to-play/cam/main.json");
        vm.setEnv("CAM_URI", URI);
        vm.prank(vm.addr(FIXTURE_KEY));
        root.transferOwnership(address(123));
        vm.prank(address(123));
        root.acceptOwnership();
        vm.expectRevert("CAM root is not owned by the public fixture account");
        refresh.run(deployment(), "pay-to-play/cam/main.json");
    }
}
