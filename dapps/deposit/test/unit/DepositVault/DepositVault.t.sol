pragma solidity 0.8.35;

import {DepositVault} from "../../../src/DepositVault.sol";

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";
import {Nonces} from "@openzeppelin-contracts-5.6.1/utils/Nonces.sol";

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

    /// @notice Settled or skipped nonces are rejected.
    /// @dev Strict nonce sequencing is the replay and ordering barrier for backend signatures.
    function testRejectsReplayWithSameNonceAndFutureNonce() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, payer, 1));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        intent = defaultIntent(100 ether, 2);

        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, payer, 1));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 1);
        assertEq(treasury.balance, 100 ether);
    }

    /// @notice The submitted payer, signer, and vault domain must match the signed authorization.
    /// @dev This preserves the SUT's no-relayer model and binds deposit authority to one signer and contract.
    function testRejectsWrongPayerSignerOrVaultDomain() external {
        address attacker = address(0xBAD);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        vm.deal(attacker, intent.amount);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.WrongPayer.selector, attacker, payer));
        vm.prank(attacker);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        bytes memory signature = signIntent(OTHER_SIGNER_KEY, intent);
        address recovered = vm.addr(OTHER_SIGNER_KEY);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, intentSigner, recovered));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        DepositVault otherVault = new DepositVault(owner, treasury, intentSigner);
        bytes32 wrongDomainDigest = digestForVault(intent, address(otherVault));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, wrongDomainDigest);
        signature = abi.encodePacked(r, s, v);
        address domainMismatchRecovered = ecrecover(digestForVault(intent, address(vault)), v, r, s);

        vm.expectRevert(
            abi.encodeWithSelector(DepositVault.InvalidIntentSignature.selector, intentSigner, domainMismatchRecovered)
        );
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
    }

    /// @notice Expired, ledger-ambiguous, zero-value, or value-mismatched intents are rejected.
    /// @dev The SUT rejects stale or unsafe accounting inputs before forwarding funds.
    function testRejectsExpiredOrUnsafePaymentFields() external {
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        intent.deadline = block.timestamp + 10;
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.warp(intent.deadline + 1);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ExpiredIntent.selector, intent.deadline));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        intent = defaultIntent(100 ether, 0);
        intent.paymentRef = bytes32(0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroPaymentRef.selector));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        intent = defaultIntent(0, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAmount.selector));
        vm.prank(payer);
        vault.deposit{value: 0}(intent, signIntent(SIGNER_KEY, intent));

        intent = defaultIntent(100 ether, 0);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, 99 ether));
        vm.prank(payer);
        vault.deposit{value: 99 ether}(intent, signIntent(SIGNER_KEY, intent));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.UnexpectedNativeAmount.selector, intent.amount, 101 ether));
        vm.prank(payer);
        vault.deposit{value: 101 ether}(intent, signIntent(SIGNER_KEY, intent));
    }

    /// @notice Treasury rotation rejects stale intents, routes future deposits, and reverts atomically on transfer failure.
    /// @dev The SUT binds signed recipients while preserving nonce and balance if the recipient rejects native value.
    function testTreasuryMigrationAndRejectedTreasuryPreserveIntentAccounting() external {
        DepositVault.DepositIntent memory staleIntent = defaultIntent(100 ether, 0);
        bytes memory staleSignature = signIntent(SIGNER_KEY, staleIntent);
        address newTreasury = address(0x7200);

        vault.setTreasury(newTreasury);

        vm.expectRevert(abi.encodeWithSelector(DepositVault.TreasuryMismatch.selector, treasury, newTreasury));
        vm.prank(payer);
        vault.deposit{value: staleIntent.amount}(staleIntent, staleSignature);

        assertEq(vault.nonces(payer), 0);
        assertEq(treasury.balance, 0);
        assertEq(newTreasury.balance, 0);

        DepositVault.DepositIntent memory intent = defaultIntentForTreasury(newTreasury, 100 ether, 0);

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(treasury.balance, 0);
        assertEq(newTreasury.balance, intent.amount);

        RejectNativeTreasury rejectingTreasury = new RejectNativeTreasury();
        vault.setTreasury(address(rejectingTreasury));

        intent = defaultIntentForTreasury(address(rejectingTreasury), 100 ether, 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                DepositVault.NativeTransferFailed.selector, address(rejectingTreasury), intent.amount
            )
        );
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signIntent(SIGNER_KEY, intent));

        assertEq(vault.nonces(payer), 1);
        assertEq(address(rejectingTreasury).balance, 0);
    }

    /// @notice Pausing is owner-only, blocks deposits, and unpausing restores the signed-intent path.
    /// @dev The SUT needs an emergency brake without giving outsiders control over policy or recovery hooks.
    function testAdminControlsAreOwnerOnlyAndPauseBlocksDepositsUntilUnpaused() external {
        address attacker = address(0xBAD);
        DepositVault.DepositIntent memory intent = defaultIntent(100 ether, 0);
        bytes memory signature = signIntent(SIGNER_KEY, intent);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        vault.setTreasury(address(0x7200));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        vault.setIntentSigner(vm.addr(OTHER_SIGNER_KEY));

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        vault.pause();

        vault.pause();

        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        vault.unpause();

        vault.unpause();

        vm.prank(payer);
        vault.deposit{value: intent.amount}(intent, signature);

        assertEq(treasury.balance, intent.amount);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        vm.prank(attacker);
        vault.sweepForcedNative();

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setTreasury(address(0));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.InvalidTreasury.selector, address(vault)));
        vault.setTreasury(address(vault));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.ZeroAddress.selector));
        vault.setIntentSigner(address(0));

        vm.expectRevert(abi.encodeWithSelector(DepositVault.RenounceDisabled.selector));
        vault.renounceOwnership();
    }

    /// @notice Direct transfers are rejected, while forced native value can be swept without a deposit receipt.
    /// @dev Creditable value must pass through deposit; unavoidable forced value uses a separate owner-only path.
    function testRejectsDirectNativeTransferAndOwnerCanSweepForcedNative() external {
        (bool ok,) = payable(address(vault)).call{value: 1 ether}("");

        assertFalse(ok);

        vm.deal(address(vault), 3 ether);

        vm.expectEmit(true, false, false, true, address(vault));
        emit ForcedNativeSwept(treasury, 3 ether);

        vault.sweepForcedNative();

        assertEq(address(vault).balance, 0);
        assertEq(treasury.balance, 3 ether);
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
