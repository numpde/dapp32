pragma solidity 0.8.35;

import {Script} from "forge-std-1.12.0/src/Script.sol";
import {BikeNftContractDeployment} from "./BikeNftContractDeployment.sol";

contract DeployContracts is Script, BikeNftContractDeployment {
    error InvalidBusinessPlan(string field);

    function _readPlan() private view returns (string memory json) {
        json = vm.readFile(vm.envString("CONTRACT_RELEASE_PLAN_PATH"));
        if (keccak256(bytes(vm.parseJsonString(json, ".schema"))) != keccak256("cam.contract-release-plan.v1")) {
            revert InvalidBusinessPlan("schema");
        }
        if (keccak256(bytes(vm.parseJsonString(json, ".app"))) != keccak256("bike-nft")) {
            revert InvalidBusinessPlan("app");
        }
        uint256 chainId = vm.parseJsonUint(json, ".expectedChainId");
        if (chainId != block.chainid) {
            revert InvalidBusinessPlan("expectedChainId");
        }
    }

    function run() external returns (Contracts memory contracts) {
        string memory json = _readPlan();
        ContractSettings memory settings;
        settings.tokenName = vm.parseJsonString(json, ".settings.tokenName");
        settings.tokenSymbol = vm.parseJsonString(json, ".settings.tokenSymbol");
        settings.baseTokenURI = vm.parseJsonString(json, ".settings.baseTokenURI");
        settings.collectionURI = vm.parseJsonString(json, ".settings.collectionURI");
        settings.intendedComponentsAdmin = vm.parseJsonAddress(json, ".settings.intendedComponentsAdmin");
        settings.componentsPauser = vm.parseJsonAddress(json, ".settings.componentsPauser");
        settings.componentsConfigurer = vm.parseJsonAddress(json, ".settings.componentsConfigurer");
        settings.intendedManagerAdmin = vm.parseJsonAddress(json, ".settings.intendedManagerAdmin");
        settings.managerPauser = vm.parseJsonAddress(json, ".settings.managerPauser");
        settings.managerConfigurer = vm.parseJsonAddress(json, ".settings.managerConfigurer");
        settings.componentsAdminDelay = _readDelay(json, ".settings.componentsAdminDelay");
        settings.managerAdminDelay = _readDelay(json, ".settings.managerAdminDelay");
        settings.registrars = vm.parseJsonAddressArray(json, ".settings.registrars");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        vm.startBroadcast(key);
        contracts = deployBikeNftContracts(settings, deployer);
        configureBikeNftContracts(contracts, settings, deployer);
        nominateBikeNftAdmins(contracts, settings, deployer);
        vm.stopBroadcast();
    }

    function _readDelay(string memory json, string memory field) private view returns (uint48) {
        uint256 value = vm.parseJsonUint(json, field);
        if (value > type(uint48).max) revert InvalidBusinessPlan(field);
        return uint48(value);
    }

}
