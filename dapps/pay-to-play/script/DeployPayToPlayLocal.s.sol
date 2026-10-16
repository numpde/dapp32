pragma solidity 0.8.35;

import {Script, console2} from "forge-std-1.12.0/src/Script.sol";
import {CamRoot} from "cam/src/CamRoot.sol";
import {PayToPlay} from "../src/PayToPlay.sol";

/// @notice Deploys only the disposable local-chain CAM fixture; purchases are created through CAM routes.
contract DeployPayToPlayLocal is Script {
    function run() external returns (CamRoot root, PayToPlay payments) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address admin = vm.addr(deployerKey);
        bytes32 camHash = sha256(vm.readFileBinary("pay-to-play/cam/main.json"));
        vm.startBroadcast(deployerKey);
        root = new CamRoot(admin, vm.envString("CAM_URI"), camHash);
        payments = new PayToPlay(admin, 60);
        root.setContractAddress("PayToPlay", address(payments));
        vm.stopBroadcast();
        console2.log("CamRoot", address(root));
        console2.log("PayToPlay", address(payments));
    }
}
