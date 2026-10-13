pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {DeployEscrowLocal} from "../../script/DeployEscrowLocal.s.sol";
import {EscrowDeployment} from "../../script/EscrowDeployment.sol";

contract DeployEscrowLocalTest is Test {
    function testFixturePinsExactMountedCamBytesDespiteExternalHash() external {
        bytes32 sourceHash = keccak256(vm.readFileBinary("escrow/cam/main.json"));
        vm.setEnv("PRIVATE_KEY", "0xbabababababababababababababababababababababababababababababababa");
        vm.setEnv("CAM_URI", "http://escrow-cam-http:8080/main.json");
        vm.setEnv("CAM_HASH", "0x1111111111111111111111111111111111111111111111111111111111111111");

        EscrowDeployment.Deployment memory deployment = new DeployEscrowLocal().run();

        assertEq(deployment.camRoot.camHash(), sourceHash);
    }
}
