pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {DeployEscrowLocal} from "../../script/DeployEscrowLocal.s.sol";
import {EscrowDeployment} from "../../script/EscrowDeployment.sol";

contract DeployEscrowLocalHarness is DeployEscrowLocal {
    function deployFixture(uint256 deployerKey, string memory camURI)
        external
        returns (EscrowDeployment.Deployment memory)
    {
        return _deploy(deployerKey, camURI);
    }
}

contract DeployEscrowLocalTest is Test {
    uint256 private constant FIXTURE_KEY = 0xbabababababababababababababababababababababababababababababababa;
    string private constant URI = "http://escrow-cam-http:8080/main.json";

    function testFixturePinsExactMountedCamBytes() external {
        bytes32 sourceHash = sha256(vm.readFileBinary("escrow/cam/main.json"));
        EscrowDeployment.Deployment memory deployment = new DeployEscrowLocalHarness().deployFixture(FIXTURE_KEY, URI);
        assertEq(deployment.camRoot.camManifest().sha256Digest, sourceHash);
        assertEq(deployment.camRoot.camManifest().uri, URI);
        assertEq(deployment.camRoot.owner(), vm.addr(FIXTURE_KEY));
    }
}
