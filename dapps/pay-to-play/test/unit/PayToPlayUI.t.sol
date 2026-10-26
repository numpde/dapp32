pragma solidity 0.8.35;

import {CamRoot} from "../../../cam/src/CamRoot.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayUI} from "../../src/PayToPlayUI.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

contract PayToPlayUITest is PayToPlayTestBase {
    CamRoot private root;
    PayToPlayUI private projection;

    function setUp() public override {
        super.setUp();
        root = new CamRoot(address(this), "data:application/json,{}", bytes32(0));
        root.setContractAddress("PayToPlay", address(payments));
        projection = new PayToPlayUI(address(payments));
    }

    function testSigningDetailsReconstructThePaymentDomainAndRegisteredKey() public view {
        PayToPlayUI.VoucherSigningDetails memory details =
            projection.viewVoucherSigningDetails(address(root), customer, channel, 100, INVOICE_HASH);
        assertEq(details.verifyingContract, address(payments));
        assertTrue(details.verifyingContract != address(root));
        assertTrue(details.verifyingContract != address(projection));
        assertEq(details.voucherKey, vm.addr(VOUCHER_KEY));
        assertEq(details.domainName, "PayToPlay");
        assertEq(details.domainVersion, "2");
        assertEq(details.chainId, block.chainid);
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(details.domainName)),
                keccak256(bytes(details.domainVersion)),
                details.chainId,
                details.verifyingContract
            )
        );
        bytes32 message = keccak256(abi.encode(payments.VOUCHER_TYPEHASH(), customer, channel, 100, INVOICE_HASH));
        assertEq(details.digest, keccak256(abi.encodePacked(hex"1901", domain, message)));
        assertEq(details.digest, payments.voucherDigest(customer, channel, 100, INVOICE_HASH));
    }

    function testSigningDetailsRejectMismatchedBindingsAndAcceptTheMatchingProjection() public {
        PayToPlay replacement = new PayToPlay(address(this), PERIOD);
        uint256 replacementChannel = replacement.createChannel(payee, relayer, PERIOD);
        address replacementKey = makeAddr("replacement voucher key");
        vm.prank(customer);
        replacement.registerVoucherKey(replacementChannel, replacementKey);
        CamRoot otherRoot = new CamRoot(address(this), "data:application/json,{}", bytes32(0));
        otherRoot.setContractAddress("PayToPlay", address(replacement));
        PayToPlayUI.VoucherSigningDetails memory original =
            projection.viewVoucherSigningDetails(address(root), customer, channel, 100, INVOICE_HASH);
        PayToPlayUI replacementProjection = new PayToPlayUI(address(replacement));
        vm.expectRevert(
            abi.encodeWithSelector(PayToPlayUI.PaymentBindingMismatch.selector, address(replacement), address(payments))
        );
        replacementProjection.viewVoucherSigningDetails(address(root), customer, channel, 100, INVOICE_HASH);
        root.setContractAddress("PayToPlay", address(replacement));
        vm.expectRevert(
            abi.encodeWithSelector(PayToPlayUI.PaymentBindingMismatch.selector, address(payments), address(replacement))
        );
        projection.viewVoucherSigningDetails(address(root), customer, replacementChannel, 100, INVOICE_HASH);
        vm.chainId(block.chainid + 1);
        PayToPlayUI.VoucherSigningDetails memory rebound = replacementProjection.viewVoucherSigningDetails(
            address(root), customer, replacementChannel, 100, INVOICE_HASH
        );
        PayToPlayUI.VoucherSigningDetails memory selected = replacementProjection.viewVoucherSigningDetails(
            address(otherRoot), customer, replacementChannel, 100, INVOICE_HASH
        );
        assertEq(rebound.verifyingContract, address(replacement));
        assertEq(rebound.voucherKey, replacementKey);
        assertEq(rebound.chainId, block.chainid);
        assertEq(rebound.digest, selected.digest);
        assertTrue(rebound.digest != original.digest);
        assertEq(payments.viewPosition(customer, channel, address(0)).voucherKey, vm.addr(VOUCHER_KEY));
    }

    function testSigningDetailsDoNotInventAKeyForAnUnregisteredPosition() public view {
        PayToPlayUI.VoucherSigningDetails memory details =
            projection.viewVoucherSigningDetails(address(root), payee, channel, 0, INVOICE_HASH);
        assertEq(details.voucherKey, address(0));
        assertEq(details.verifyingContract, address(payments));
        assertEq(details.digest, payments.voucherDigest(payee, channel, 0, INVOICE_HASH));
    }

    function testSigningDetailsRejectAnUnknownChannelAtThePaymentContract() public {
        uint256 unknown = payments.channelCount();
        vm.expectRevert(abi.encodeWithSelector(PayToPlay.ChannelNotFound.selector, unknown));
        projection.viewVoucherSigningDetails(address(root), customer, unknown, 100, INVOICE_HASH);
    }
}
