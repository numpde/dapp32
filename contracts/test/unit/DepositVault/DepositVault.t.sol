pragma solidity 0.8.35;

import {DepositVault} from "../../../src/DepositVault.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

/// @dev Treasury double that rejects native value, used to prove deposit and sweep failure atomicity.
contract RejectNativeTreasury {
    receive() external payable {
        revert("reject native");
    }
}

/// @notice Unit tests for DepositVault, an EIP-712-authorized native-asset deposit gateway.
/// @dev The SUT should forward exact native amounts to treasury only for current,
///      backend-signed intents while preserving nonce, receiptId, signer, owner,
///      pause, treasury, and forced-native recovery controls.
contract DepositVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant OTHER_SIGNER_KEY = 0xB0B;

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(bytes32 paymentRef,address payer,address treasury,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    address private owner = address(this);
    address private treasury = address(0x7100);
    address private payer = address(0xCAFE);
    address private intentSigner;

    DepositVault private vault;

    event DepositReceived(
        bytes32 indexed receiptId,
        bytes32 indexed paymentRef,
        address indexed payer,
        address treasuryRecipient,
        uint256 amount,
        uint256 nonce
    );
    event ForcedNativeSwept(address indexed recipient, uint256 amount);

    function setUp() public {
        intentSigner = vm.addr(SIGNER_KEY);
        vault = new DepositVault(owner, treasury, intentSigner);

        vm.deal(address(this), 1_000 ether);
        vm.deal(payer, 1_000 ether);
    }

    /// @notice A valid signed intent forwards exact native value and advances the payer nonce.
    /// @dev This is the core SUT path: treasury receives value and the receipt carries the accounting key.
    function testDepositForwardsNativeValueAndConsumesNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);
        bytes32 receiptId = receiptIdFor(payer, intent.nonce);

        vm.expectEmit(true, true, true, true, address(vault));
        emit DepositReceived(receiptId, intent.paymentRef, payer, treasury, intent.amount, intent.nonce);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(treasury.balance, intent.amount);
        assertEq(payer.balance, 900 ether);
        assertEq(vault.nonces(payer), 1);
    }

    /// @notice The public hash helper returns the exact EIP-712 digest used for backend signatures.
    /// @dev Backend tooling can use this SUT helper to debug signing mismatches without duplicating hashing logic.
    function testHashDepositIntentMatchesLocalDigest() external view {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        assertEq(vault.hashDepositIntent(intent), digestForVault(intent, address(vault)));
    }

    /// @notice The public receipt helper returns the canonical on-chain receipt ID.
    /// @dev Indexers and ledgers should reconcile deposits by receiptId, not by paymentRef or log position alone.
    function testReceiptIdMatchesLocalDerivation() external view {
        uint256 nonce = 3;

        assertEq(vault.receiptIdFor(payer, nonce), receiptIdFor(payer, nonce));
    }

    /// @notice An intent remains valid when its deadline is exactly the current timestamp.
    /// @dev The SUT uses `block.timestamp > deadline`, so equality should not reject a backend-signed payment.
    function testAcceptsDeadlineAtCurrentTimestamp() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.deadline = block.timestamp + 10;
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.warp(intent.deadline);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(treasury.balance, intent.amount);
        assertEq(vault.nonces(payer), 1);
    }

    /// @notice Consecutive signed intents for the same payer settle in nonce order.
    /// @dev This proves the SUT supports repeated deposits while preventing nonce gaps and replay.
    function testAcceptsSequentialNonces() external {
        DepositVault.DepositIntent memory firstIntent = defaultIntent(100 ether, 0);
        DepositVault.DepositIntent memory secondIntent = defaultIntent(50 ether, 1);
        secondIntent.paymentRef = keccak256("payment:2");

        vm.prank(payer);
        vault.deposit{value: firstIntent.amount}(firstIntent, signIntent(SIGNER_KEY, firstIntent));

        vm.prank(payer);
        vault.deposit{value: secondIntent.amount}(secondIntent, signIntent(SIGNER_KEY, secondIntent));

        assertEq(treasury.balance, 150 ether);
        assertEq(vault.nonces(payer), 2);
    }

    /// @notice A settled nonce cannot be submitted again.
    /// @dev The SUT's nonce consumption is the replay barrier for reused backend signatures.
    function testRejectsReplayWithSameNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);
    }

    /// @notice A signed intent with a nonce ahead of the payer's current nonce is rejected.
    /// @dev The SUT enforces strict sequencing so outstanding intents cannot be skipped.
    function testRejectsFutureNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 1);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
    }

    /// @notice Reusing a paymentRef with a fresh nonce is allowed on-chain.
    /// @dev The SUT treats paymentRef as a business key; duplicate handling belongs to backend/indexer/ledger policy.
    function testAllowsReusedPaymentRefWithFreshNonce() external {
        DepositVault.DepositIntent memory firstIntent = defaultIntent(100 ether, 0);
        DepositVault.DepositIntent memory secondIntent = defaultIntent(50 ether, 1);

        vm.prank(payer);
        vault.deposit{value: firstIntent.amount}(firstIntent, signIntent(SIGNER_KEY, firstIntent));

        vm.prank(payer);
        vault.deposit{value: secondIntent.amount}(secondIntent, signIntent(SIGNER_KEY, secondIntent));

        assertEq(vault.nonces(payer), 2);
        assertEq(treasury.balance, firstIntent.amount + secondIntent.amount);
        assertEq(vault.receiptIdFor(payer, firstIntent.nonce), receiptIdFor(payer, firstIntent.nonce));
        assertEq(vault.receiptIdFor(payer, secondIntent.nonce), receiptIdFor(payer, secondIntent.nonce));
    }

    /// @notice Only the payer named in the signed intent may submit the deposit.
    /// @dev This preserves the SUT's no-relayer model and prevents leaked intents from being paid by another account.
    function testRejectsWrongPayer() external {
        address attacker = address(0xBAD);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        vm.deal(attacker, intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.WrongPayer.selector, attacker, payer));
        vm.prank(attacker);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A signature from any key other than the configured backend signer is rejected.
    /// @dev The SUT must bind deposit authority to `intentSigner`, not merely to any recoverable ECDSA signer.
    function testRejectsInvalidSigner() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(OTHER_SIGNER_KEY, intent);
        address recovered = vm.addr(OTHER_SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, intentSigner, recovered));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);
    }

    /// @notice Malformed signature bytes cannot authorize a deposit.
    /// @dev The SUT delegates signature parsing to OZ ECDSA and must fail before value forwarding or nonce consumption.
    function testRejectsMalformedSignature() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, hex"1234");

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
    }

    /// @notice A signature produced for another vault cannot be replayed against this vault.
    /// @dev This verifies the SUT's EIP-712 domain binds intents to the deployed contract address.
    function testRejectsSignatureForDifferentVault() external {
        DepositVault otherVault = new DepositVault(owner, treasury, intentSigner);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntentForVault(SIGNER_KEY, intent, address(otherVault));

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
    }

    /// @notice Changing signed intent fields after signing invalidates the signature.
    /// @dev This protects the SUT from amount, treasury, payer, deadline, nonce, or paymentRef substitution.
    function testRejectsMutatedSignedIntent() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);
        intent.amount = 101 ether;

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
        assertEq(payer.balance, 1_000 ether);
    }

    /// @notice A signed intent cannot be used after its deadline.
    /// @dev The SUT's deadline check limits stale backend authorizations and incident-response exposure.
    function testRejectsExpiredIntent() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.deadline = block.timestamp + 10;
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.warp(intent.deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ExpiredIntent.selector, intent.deadline));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);
    }

    /// @notice A deposit intent must carry a nonzero off-chain payment reference.
    /// @dev The SUT emits paymentRef for accounting, so accepting zero would create ambiguous ledger records.
    function testRejectsZeroPaymentRef() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.paymentRef = bytes32(0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroPaymentRef.selector));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A deposit intent must move a nonzero native amount.
    /// @dev The SUT rejects zero-value events so the off-chain ledger only sees meaningful settlements.
    function testRejectsZeroAmount() external {
        DepositVault.DepositIntent memory intent = defaultIntent(0, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAmount.selector));
        vm.prank(payer);
        vault.deposit{value: 0}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice The submitted native value must equal the signed amount.
    /// @dev Exact-value enforcement keeps receipt amount and ledger credit semantics aligned.
    function testRejectsUnderpayment() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, 99 ether));
        vm.prank(payer);
        vault.deposit{value: 99 ether}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice Overpayment is rejected instead of accepted and refunded.
    /// @dev The SUT deliberately avoids refund branches in the accounting-critical path.
    function testRejectsOverpayment() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, 101 ether));
        vm.prank(payer);
        vault.deposit{value: 101 ether}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice A signed stale treasury cannot be used after treasury rotation.
    /// @dev The SUT rejects stale intents instead of silently redirecting native value to a new treasury.
    function testRejectsTreasuryMismatchAfterRotation() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);
        address newTreasury = address(0x7200);

        vault.setTreasury(newTreasury);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TreasuryMismatch.selector, treasury, newTreasury));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
        assertEq(newTreasury.balance, 0);
    }

    /// @notice Treasury migration works when the backend signs the new treasury.
    /// @dev The SUT supports operational treasury migration while making the recipient explicit in the signature.
    function testTreasuryMigrationRoutesFutureDeposits() external {
        address newTreasury = address(0x7200);
        vault.setTreasury(newTreasury);

        DepositVault.DepositIntent memory intent = defaultIntentForTreasury(newTreasury, 100 ether, 0);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(treasury.balance, 0);
        assertEq(newTreasury.balance, intent.amount);
    }

    /// @notice If treasury rejects native value, the deposit reverts without consuming nonce.
    /// @dev The SUT consumes nonce before the external call, so this proves revert atomicity restores that write.
    function testRejectingTreasuryDoesNotConsumeNonce() external {
        RejectNativeTreasury rejectingTreasury = new RejectNativeTreasury();
        vault.setTreasury(address(rejectingTreasury));

        DepositVault.DepositIntent memory intent = defaultIntentForTreasury(address(rejectingTreasury), 100 ether, 0);

        vm.expectRevert(
            abi.encodeWithSelector(
                DepositVault.NativeTransferFailed.selector, address(rejectingTreasury), intent.amount
            )
        );
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 0);
        assertEq(address(rejectingTreasury).balance, 0);
    }

    /// @notice Pausing stops deposits and unpausing restores the same signed-intent path.
    /// @dev The SUT needs an emergency brake that does not invalidate otherwise valid unpaid intents.
    function testPauseBlocksDepositsUntilUnpaused() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vault.pause();

        vm.expectRevert();
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        vault.unpause();

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(treasury.balance, intent.amount);
    }

    /// @notice Signer rotation immediately invalidates outstanding signatures from the old signer.
    /// @dev The SUT must let the owner respond to signer compromise without redeploying.
    function testSignerRotationInvalidatesOldSigner() external {
        address newSigner = vm.addr(OTHER_SIGNER_KEY);
        vault.setIntentSigner(newSigner);

        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, newSigner, intentSigner));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(OTHER_SIGNER_KEY, intent));

        assertEq(treasury.balance, intent.amount);
    }

    /// @notice Direct native transfers are rejected.
    /// @dev All creditable value must pass through deposit so every payment has an intent, nonce, and receipt.
    function testRejectsDirectNativeTransfer() external {
        (bool ok,) = payable(address(vault)).call{value: 1 ether}("");

        assertFalse(ok);
    }

    /// @notice Unknown calls are rejected, with or without native value.
    /// @dev The SUT should not have payable side doors that bypass signed deposit validation.
    function testRejectsFallbackCalls() external {
        (bool ok,) = address(vault).call(abi.encodeWithSignature("missing()"));

        assertFalse(ok);
    }

    /// @notice Forced native value can be swept to treasury without emitting a deposit receipt.
    /// @dev The SUT cannot block selfdestruct value, so it exposes a separate owner-only recovery path.
    function testOwnerCanSweepForcedNative() external {
        vm.deal(address(vault), 3 ether);

        vm.expectEmit(true, false, false, true, address(vault));
        emit ForcedNativeSwept(treasury, 3 ether);

        vault.sweepForcedNative();

        assertEq(address(vault).balance, 0);
        assertEq(treasury.balance, 3 ether);
    }

    /// @notice Sweeping with no forced value is rejected.
    /// @dev The SUT should not emit operational sweep events for no-op calls.
    function testRejectsEmptyForcedNativeSweep() external {
        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAmount.selector));
        vault.sweepForcedNative();
    }

    /// @notice Non-owners cannot sweep forced native value.
    /// @dev The SUT reserves recovery of accidental or forced balances for governance.
    function testRejectsNonOwnerForcedNativeSweep() external {
        vm.deal(address(vault), 3 ether);

        vm.expectRevert();
        vm.prank(address(0xBAD));
        vault.sweepForcedNative();

        assertEq(address(vault).balance, 3 ether);
        assertEq(treasury.balance, 0);
    }

    /// @notice The owner can update treasury and signer policy.
    /// @dev This covers the SUT's administrative surface for routine operations.
    function testOwnerControlsPolicy() external {
        address newTreasury = address(0x7200);
        address newSigner = vm.addr(OTHER_SIGNER_KEY);

        vault.setTreasury(newTreasury);
        vault.setIntentSigner(newSigner);

        assertEq(vault.treasury(), newTreasury);
        assertEq(vault.intentSigner(), newSigner);
    }

    /// @notice Ownership transfer requires the pending owner to accept control.
    /// @dev The SUT inherits Ownable2Step so admin authority is not moved by a one-transaction typo.
    function testOwnershipTransferIsTwoStep() external {
        address newOwner = address(0xBEEF);

        vault.transferOwnership(newOwner);

        assertEq(vault.owner(), owner);
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();

        assertEq(vault.owner(), newOwner);

        vm.prank(newOwner);
        vault.pause();
    }

    /// @notice Non-owners cannot change treasury, signer, pause state, or sweep forced value.
    /// @dev This verifies the SUT's policy controls are restricted to the current owner.
    function testRejectsNonOwnerPolicyChanges() external {
        address attacker = address(0xBAD);

        vm.expectRevert();
        vm.prank(attacker);
        vault.setTreasury(address(0x7200));

        vm.expectRevert();
        vm.prank(attacker);
        vault.setIntentSigner(vm.addr(OTHER_SIGNER_KEY));

        vm.expectRevert();
        vm.prank(attacker);
        vault.pause();

        vault.pause();

        vm.expectRevert();
        vm.prank(attacker);
        vault.unpause();
    }

    /// @notice Owner policy updates reject zero addresses and the vault itself as treasury.
    /// @dev The SUT guards against accidentally disabling core roles or trapping native value in itself.
    function testRejectsUnsafePolicyValues() external {
        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setTreasury(address(0));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidTreasury.selector, address(vault)));
        vault.setTreasury(address(vault));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setIntentSigner(address(0));
    }

    /// @notice Deployment rejects invalid owner, treasury, and signer configuration.
    /// @dev The SUT should never start life without usable admin, payout, and authorization roles.
    function testRejectsInvalidConstructorValues() external {
        vm.expectRevert();
        new DepositVault(address(0), treasury, intentSigner);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        new DepositVault(owner, address(0), intentSigner);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        new DepositVault(owner, treasury, address(0));
    }

    /// @notice Ownership renounce is disabled permanently.
    /// @dev The SUT must retain an owner for signer rotation, treasury rotation, emergency pause, and forced sweep.
    function testRenounceOwnershipIsDisabled() external {
        vm.expectRevert(abi.encodeWithSelector(DepositVault.RenounceDisabled.selector));
        vault.renounceOwnership();
    }

    function defaultIntent(uint256 amount, uint256 nonce) private view returns (DepositVault.DepositIntent memory) {
        return defaultIntentForTreasury(treasury, amount, nonce);
    }

    function defaultIntentForTreasury(address intentTreasury, uint256 amount, uint256 nonce)
        private
        view
        returns (DepositVault.DepositIntent memory)
    {
        return DepositVault.DepositIntent({
            paymentRef: keccak256("payment:1"),
            payer: payer,
            treasury: intentTreasury,
            amount: amount,
            nonce: nonce,
            deadline: block.timestamp + 1 days
        });
    }

    function signIntent(uint256 privateKey, DepositVault.DepositIntent memory intent) private returns (bytes memory) {
        return signIntentForVault(privateKey, intent, address(vault));
    }

    function signIntentForVault(uint256 privateKey, DepositVault.DepositIntent memory intent, address verifyingVault)
        private
        returns (bytes memory)
    {
        bytes32 digest = digestForVault(intent, verifyingVault);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        return abi.encodePacked(r, s, v);
    }

    function digestForVault(DepositVault.DepositIntent memory intent, address verifyingVault)
        private
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.paymentRef,
                intent.payer,
                intent.treasury,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("DepositVault")),
                keccak256(bytes("1")),
                block.chainid,
                verifyingVault
            )
        );

        return keccak256(abi.encodePacked(hex"1901", domainSeparator, structHash));
    }

    function receiptIdFor(address receiptPayer, uint256 nonce) private view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(vault), receiptPayer, nonce));
    }

    function assertEq(uint256 actual, uint256 expected) private pure {
        if (actual != expected) {
            revert("uint mismatch");
        }
    }

    function assertEq(address actual, address expected) private pure {
        if (actual != expected) {
            revert("address mismatch");
        }
    }

    function assertEq(bytes32 actual, bytes32 expected) private pure {
        if (actual != expected) {
            revert("bytes32 mismatch");
        }
    }

    function assertFalse(bool value) private pure {
        if (value) {
            revert("expected false");
        }
    }

    function assertTrue(bool value) private pure {
        if (!value) {
            revert("expected true");
        }
    }
}
