pragma solidity 0.8.35;

import {Nonces} from "@openzeppelin-contracts-5.6.1/utils/Nonces.sol";

import {DepositVault} from "../../../src/DepositVault.sol";
import {DepositVaultTestBase} from "../../support/DepositVault/TestBase.sol";

/// @notice Unit tests for DepositVault deposit authorization semantics.
/// @dev These tests focus on whether a deposit can settle only when the
///      caller, signed intent fields, current treasury, current signer, value,
///      deadline, and payer nonce all match the contract's authorization model.
contract DepositVaultDepositAuthorizationTest is DepositVaultTestBase {
    function test_deposit_acceptsValidSignedIntent() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();

        _expectDepositReceived(intent);
        _depositAsPayer(intent);
    }

    function test_deposit_revertsWhenCallerIsNotPayer() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.WrongPayer.selector, stranger, intent.payer));
        _depositAs(stranger, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenPaymentRefIsZero() public {
        DepositVault.DepositIntent memory intent = _intent({
            paymentRef: bytes32(0),
            intentPayer: payer,
            intentTreasury: treasury,
            amount: DEFAULT_AMOUNT,
            nonce: vault.nonces(payer),
            deadline: block.timestamp + DEFAULT_DEADLINE_DELTA
        });
        bytes memory signature = _signIntent(intent);

        vm.expectRevert(DepositVault.ZeroPaymentRef.selector);
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenAmountIsZero() public {
        DepositVault.DepositIntent memory intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: payer,
            intentTreasury: treasury,
            amount: 0,
            nonce: vault.nonces(payer),
            deadline: block.timestamp + DEFAULT_DEADLINE_DELTA
        });
        bytes memory signature = _signIntent(intent);

        vm.expectRevert(DepositVault.ZeroAmount.selector);
        _depositAs(payer, intent, signature, 0);
    }

    function test_deposit_revertsWhenMsgValueIsTooLow() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);
        uint256 received = intent.amount - 1;

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, received));
        _depositAs(payer, intent, signature, received);
    }

    function test_deposit_revertsWhenMsgValueIsTooHigh() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);
        uint256 received = intent.amount + 1;

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, received));
        _depositAs(payer, intent, signature, received);
    }

    function test_deposit_revertsWhenIntentIsExpired() public {
        vm.warp(1_000);

        DepositVault.DepositIntent memory intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: payer,
            intentTreasury: treasury,
            amount: DEFAULT_AMOUNT,
            nonce: vault.nonces(payer),
            deadline: block.timestamp - 1
        });
        bytes memory signature = _signIntent(intent);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ExpiredIntent.selector, intent.deadline));
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_acceptsIntentAtExactDeadline() public {
        DepositVault.DepositIntent memory intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: payer,
            intentTreasury: treasury,
            amount: DEFAULT_AMOUNT,
            nonce: vault.nonces(payer),
            deadline: block.timestamp
        });

        _expectDepositReceived(intent);
        _depositAsPayer(intent);
    }

    function test_deposit_revertsWhenSignedTreasuryDiffersFromCurrentTreasury() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        vm.prank(owner);
        vault.setTreasury(newTreasury);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TreasuryMismatch.selector, intent.treasury, newTreasury));
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenSignerIsNotCurrentIntentSigner() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntentWithPk(NEW_INTENT_SIGNER_PK, intent);

        vm.expectRevert(
            abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, intentSigner, newIntentSigner)
        );
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenOldSignerIsUsedAfterSignerRotation() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory oldSignerSignature = _signIntent(intent);

        vm.prank(owner);
        vault.setIntentSigner(newIntentSigner);

        vm.expectRevert(
            abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, newIntentSigner, intentSigner)
        );
        _depositAs(payer, intent, oldSignerSignature, intent.amount);
    }

    function test_deposit_revertsWhenPaymentRefIsTampered() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        intent.paymentRef = keccak256("payment-ref/tampered");

        vm.expectRevert();
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenPayerIsTamperedEvenIfCallerMatchesTamperedPayer() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        intent.payer = otherPayer;
        intent.nonce = vault.nonces(otherPayer);

        vm.expectRevert();
        _depositAs(otherPayer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenTreasuryIsTamperedEvenIfCurrentTreasuryMatchesTamperedTreasury() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        vm.prank(owner);
        vault.setTreasury(newTreasury);

        intent.treasury = newTreasury;

        vm.expectRevert();
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenAmountIsTampered() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        intent.amount = intent.amount + 1;

        vm.expectRevert();
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenNonceIsTamperedBeforeNonceCheck() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        intent.nonce = intent.nonce + 1;

        vm.expectRevert();
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenDeadlineIsTampered() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        intent.deadline = intent.deadline + 1;

        vm.expectRevert();
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenValidlySignedFutureNonceIsUsed() public {
        uint256 currentNonce = vault.nonces(payer);
        DepositVault.DepositIntent memory intent = _intentWithNonce({intentPayer: payer, nonce: currentNonce + 1});
        bytes memory signature = _signIntent(intent);

        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, payer, currentNonce));
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenIntentIsReplayed() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory signature = _signIntent(intent);

        _depositAs(payer, intent, signature, intent.amount);

        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, payer, intent.nonce + 1));
        _depositAs(payer, intent, signature, intent.amount);
    }

    function test_deposit_revertsWhenSignatureIsMalformed() public {
        DepositVault.DepositIntent memory intent = _defaultIntent();
        bytes memory malformedSignature = hex"1234";

        vm.expectRevert();
        _depositAs(payer, intent, malformedSignature, intent.amount);
    }
}
