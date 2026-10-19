pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";
import {ICamApp} from "../../src/ICamApp.sol";
import {CamRoot} from "../../src/CamRoot.sol";

contract CamRootTest is Test {
    function testManifestReferenceIsUpdatedAsOnePair() external {
        CamRoot root = new CamRoot(address(this), "https://example.test/first.json", sha256("first"));
        ICamApp.ManifestRef memory first = root.camManifest();
        assertEq(first.uri, "https://example.test/first.json");
        assertEq(first.sha256Digest, sha256("first"));
        root.setCam("ipfs://second", sha256("second"));
        ICamApp.ManifestRef memory second = root.camManifest();
        assertEq(second.uri, "ipfs://second");
        assertEq(second.sha256Digest, sha256("second"));
    }

    function testFuzzManifestReferenceCarriesEveryDigest(bytes32 digest) external {
        CamRoot root = new CamRoot(address(this), "https://example.test/root.json", digest);
        assertEq(root.camManifest().sha256Digest, digest);
        root.setCam("ipfs://updated", bytes32(0));
        assertEq(root.camManifest().sha256Digest, bytes32(0));
    }

    function testInterfaceIncludesManifestAndResolverAndRejectsOldGetters() external {
        CamRoot root = new CamRoot(address(this), "ipfs://root", bytes32(0));
        bytes4 expected = ICamApp.camManifest.selector ^ ICamApp.contractAddress.selector;
        assertEq(expected, bytes4(0xb6a5fc7c));
        assertEq(type(ICamApp).interfaceId, expected);
        assertTrue(root.supportsInterface(expected));
        assertTrue(root.supportsInterface(type(IERC165).interfaceId));
        assertFalse(root.supportsInterface(bytes4(keccak256("camURI()")) ^ bytes4(keccak256("camHash()"))));
        (bool uriOk,) = address(root).staticcall(abi.encodeWithSignature("camURI()"));
        (bool hashOk,) = address(root).staticcall(abi.encodeWithSignature("camHash()"));
        assertFalse(uriOk);
        assertFalse(hashOk);
        assertEq(ICamApp(address(root)).contractAddress("Escrow"), address(0));
        root.setContractAddress("Escrow", address(0xBEEF));
        assertEq(ICamApp(address(root)).contractAddress("Escrow"), address(0xBEEF));
    }

    function testNameResolverSetsAndClearsBindingWithoutHashSelector() external {
        CamRoot root = new CamRoot(address(this), "ipfs://root", bytes32(0));
        root.setContractAddress("Escrow", address(0xBEEF));
        assertEq(root.contractAddress("Escrow"), address(0xBEEF));

        (bool hashOk,) =
            address(root).staticcall(abi.encodeWithSignature("contractAddressByHash(bytes32)", keccak256("Escrow")));
        assertFalse(hashOk);

        root.setContractAddress("Escrow", address(0));
        assertEq(root.contractAddress("Escrow"), address(0));
    }
}
