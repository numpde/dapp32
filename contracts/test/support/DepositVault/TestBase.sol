pragma solidity 0.8.35;

import {DepositVault} from "../../../src/DepositVault.sol";

interface DepositVaultTestVm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData, address emitter) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

/// @notice Shared setup and helpers for DepositVault tests.
/// @dev This file should not contain actual `test_*` functions.
///      Unit, fuzz, and invariant tests should inherit from this base.
abstract contract DepositVaultTestBase {
    DepositVaultTestVm internal constant vm =
        DepositVaultTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // -------------------------------------------------------------------------
    // Actors
    // -------------------------------------------------------------------------

    uint256 internal constant OWNER_PK = 0xA11CE;
    uint256 internal constant INTENT_SIGNER_PK = 0xB0B;
    uint256 internal constant NEW_INTENT_SIGNER_PK = 0xCAFE;
    uint256 internal constant PAYER_PK = 0x1234;
    uint256 internal constant OTHER_PAYER_PK = 0x5678;

    address internal owner;
    address internal intentSigner;
    address internal newIntentSigner;
    address internal payer;
    address internal otherPayer;
    address internal stranger;

    address internal treasury;
    address internal newTreasury;

    DepositVault internal vault;

    // -------------------------------------------------------------------------
    // Defaults
    // -------------------------------------------------------------------------

    bytes32 internal constant DEFAULT_PAYMENT_REF = keccak256("payment-ref/default");

    uint256 internal constant DEFAULT_AMOUNT = 1 ether;
    uint256 internal constant DEFAULT_DEADLINE_DELTA = 1 hours;

    // Keep this in sync with DepositVault.
    bytes32 internal constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(bytes32 paymentRef,address payer,address treasury,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // Keep these in sync with DepositVault's EIP712 constructor.
    string internal constant EIP712_NAME = "DepositVault";
    string internal constant EIP712_VERSION = "1";

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @dev Redeclare event so tests can use vm.expectEmit.
    ///      Must match DepositVault exactly.
    event DepositReceived(
        bytes32 indexed receiptId,
        bytes32 indexed paymentRef,
        address indexed payer,
        address treasuryRecipient,
        uint256 amount,
        uint256 nonce
    );

    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event IntentSignerSet(address indexed oldSigner, address indexed newSigner);

    // -------------------------------------------------------------------------
    // Setup
    // -------------------------------------------------------------------------

    function setUp() public virtual {
        owner = vm.addr(OWNER_PK);
        intentSigner = vm.addr(INTENT_SIGNER_PK);
        newIntentSigner = vm.addr(NEW_INTENT_SIGNER_PK);
        payer = vm.addr(PAYER_PK);
        otherPayer = vm.addr(OTHER_PAYER_PK);
        stranger = makeAddr("stranger");

        treasury = makeAddr("treasury");
        newTreasury = makeAddr("newTreasury");

        vm.deal(owner, 100 ether);
        vm.deal(payer, 100 ether);
        vm.deal(otherPayer, 100 ether);
        vm.deal(stranger, 100 ether);

        vault = _deployVault(owner, treasury, intentSigner);
    }

    function _deployVault(address initialOwner, address initialTreasury, address initialIntentSigner)
        internal
        returns (DepositVault deployed)
    {
        deployed = new DepositVault(initialOwner, initialTreasury, initialIntentSigner);
    }

    // -------------------------------------------------------------------------
    // Intent helpers
    // -------------------------------------------------------------------------

    function _defaultIntent() internal view returns (DepositVault.DepositIntent memory intent) {
        intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: payer,
            intentTreasury: treasury,
            amount: DEFAULT_AMOUNT,
            nonce: vault.nonces(payer),
            deadline: block.timestamp + DEFAULT_DEADLINE_DELTA
        });
    }

    function _intent(
        bytes32 paymentRef,
        address intentPayer,
        address intentTreasury,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) internal pure returns (DepositVault.DepositIntent memory intent) {
        intent = DepositVault.DepositIntent({
            paymentRef: paymentRef,
            payer: intentPayer,
            treasury: intentTreasury,
            amount: amount,
            nonce: nonce,
            deadline: deadline
        });
    }

    function _intentForPayer(address intentPayer, uint256 amount)
        internal
        view
        returns (DepositVault.DepositIntent memory intent)
    {
        intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: intentPayer,
            intentTreasury: treasury,
            amount: amount,
            nonce: vault.nonces(intentPayer),
            deadline: block.timestamp + DEFAULT_DEADLINE_DELTA
        });
    }

    function _intentWithNonce(address intentPayer, uint256 nonce)
        internal
        view
        returns (DepositVault.DepositIntent memory intent)
    {
        intent = _intent({
            paymentRef: DEFAULT_PAYMENT_REF,
            intentPayer: intentPayer,
            intentTreasury: treasury,
            amount: DEFAULT_AMOUNT,
            nonce: nonce,
            deadline: block.timestamp + DEFAULT_DEADLINE_DELTA
        });
    }

    // -------------------------------------------------------------------------
    // Signature helpers
    // -------------------------------------------------------------------------

    function _signIntent(DepositVault.DepositIntent memory intent) internal returns (bytes memory signature) {
        signature = _signIntentWithPk(INTENT_SIGNER_PK, intent);
    }

    function _signIntentWithPk(uint256 privateKey, DepositVault.DepositIntent memory intent)
        internal
        returns (bytes memory signature)
    {
        bytes32 digest = _hashDepositIntent(intent);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);

        signature = abi.encodePacked(r, s, v);
    }

    function _hashDepositIntent(DepositVault.DepositIntent memory intent) internal view returns (bytes32 digest) {
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

        digest = _hashTypedDataV4(structHash);
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32 digest) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(EIP712_NAME)),
                keccak256(bytes(EIP712_VERSION)),
                block.chainid,
                address(vault)
            )
        );

        digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    // -------------------------------------------------------------------------
    // Receipt helpers
    // -------------------------------------------------------------------------

    function _receiptId(address receiptPayer, uint256 nonce) internal view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(vault), receiptPayer, nonce));
    }

    function _expectDepositReceived(DepositVault.DepositIntent memory intent) internal {
        bytes32 expectedReceiptId = _receiptId(intent.payer, intent.nonce);

        vm.expectEmit(true, true, true, true, address(vault));
        emit DepositReceived(
            expectedReceiptId, intent.paymentRef, intent.payer, intent.treasury, intent.amount, intent.nonce
        );
    }

    // -------------------------------------------------------------------------
    // Deposit helpers
    // -------------------------------------------------------------------------

    function _depositAsPayer(DepositVault.DepositIntent memory intent) internal returns (bytes memory signature) {
        signature = _signIntent(intent);

        vm.prank(intent.payer);
        vault.deposit{value: intent.amount}(intent, signature);
    }

    function _depositAs(address caller, DepositVault.DepositIntent memory intent, bytes memory signature, uint256 value)
        internal
    {
        vm.prank(caller);
        vault.deposit{value: value}(intent, signature);
    }

    function _defaultDeposit() internal returns (DepositVault.DepositIntent memory intent, bytes memory signature) {
        intent = _defaultIntent();
        signature = _signIntent(intent);

        vm.prank(intent.payer);
        vault.deposit{value: intent.amount}(intent, signature);
    }

    // -------------------------------------------------------------------------
    // Common assertions
    // -------------------------------------------------------------------------

    function _assertSuccessfulDepositEffects(
        DepositVault.DepositIntent memory intent,
        uint256 treasuryBalanceBefore,
        uint256 vaultBalanceBefore
    ) internal view {
        assertEq(treasury.balance, treasuryBalanceBefore + intent.amount, "treasury balance");

        assertEq(address(vault).balance, vaultBalanceBefore, "vault balance");

        assertEq(vault.nonces(intent.payer), intent.nonce + 1, "payer nonce");
    }

    function _assertNoSettlementEffects(
        DepositVault.DepositIntent memory intent,
        uint256 treasuryBalanceBefore,
        uint256 vaultBalanceBefore,
        uint256 payerNonceBefore
    ) internal view {
        assertEq(treasury.balance, treasuryBalanceBefore, "treasury balance");
        assertEq(address(vault).balance, vaultBalanceBefore, "vault balance");
        assertEq(vault.nonces(intent.payer), payerNonceBefore, "payer nonce");
    }

    function makeAddr(string memory name) internal pure returns (address) {
        return address(uint160(uint256(keccak256(bytes(name)))));
    }

    function assertEq(uint256 actual, uint256 expected, string memory reason) internal pure {
        if (actual != expected) {
            revert(reason);
        }
    }

    function assertEq(address actual, address expected, string memory reason) internal pure {
        if (actual != expected) {
            revert(reason);
        }
    }
}
