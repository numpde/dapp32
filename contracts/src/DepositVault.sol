pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin-contracts-5.6.1/access/Ownable2Step.sol";

import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin-contracts-5.6.1/utils/ReentrancyGuard.sol";
import {Nonces} from "@openzeppelin-contracts-5.6.1/utils/Nonces.sol";

import {EIP712} from "@openzeppelin-contracts-5.6.1/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin-contracts-5.6.1/utils/cryptography/ECDSA.sol";

/// @notice Minimal native-asset deposit gateway for off-chain credit accounting.
/// @dev This contract is not a ledger. It verifies backend-signed intents,
///      forwards native value to treasury, and emits receipts for an off-chain indexer.
///
///      EIP-712 binds signatures to this chain and this deployed contract.
///
///      Backend requirements:
///      - store payment intents before returning signatures;
///      - enforce `unique(chain_id, contract_address, payer, nonce)`;
///      - enforce `unique(chain_id, contract_address, paymentRef)` if each payment
///        reference is intended to settle at most once;
///      - for the minimal product, allow at most one active unpaid intent per payer;
///      - read `nonces(payer)` on the target chain before signing;
///      - sign `amount` in wei and the intended treasury recipient;
///      - use short deadlines for quoted native-asset prices.
///
///      Indexer requirements:
///      - credit only confirmed `DepositReceived` events;
///      - dedupe by `(chain_id, contract_address, tx_hash, log_index)`;
///      - treat `paymentRef` as a business key, not an event ID;
///      - handle reorgs before final ledger settlement;
///      - never credit from `address(this).balance`.
contract DepositVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712, Nonces {
    /// @notice Backend-authorized native-asset deposit instruction.
    /// @dev `paymentRef` links the on-chain receipt to off-chain accounting.
    ///      `amount` is denominated in wei.
    ///
    ///      Nonce gotcha:
    ///      The nonce is strict and per payer. For a given payer, only the next
    ///      nonce can succeed. Multiple live intents with the same
    ///      `(chain_id, contract_address, payer, nonce)` create a race where only
    ///      one can settle.
    struct DepositIntent {
        bytes32 paymentRef;
        address payer;
        address treasury;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 private constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(bytes32 paymentRef,address payer,address treasury,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @notice Destination that receives all deposited native value immediately.
    /// @dev Use a multisig or hardened treasury address that can receive native value.
    ///      If treasury rejects value, the deposit reverts and no receipt is emitted.
    address public treasury;

    /// @notice Backend-controlled ECDSA signer that authorizes deposit intents.
    /// @dev Intended for an EOA/HSM/KMS-style signing key. If a Safe or ERC-1271
    ///      contract signer is required later, replace ECDSA recovery with
    ///      SignatureChecker and re-review revocation/call semantics.
    address public intentSigner;

    /// @notice Tracks payment references that have already settled in this vault.
    /// @dev Remove this mapping only if your business process intentionally allows
    ///      multiple successful deposits with the same `paymentRef`.
    mapping(bytes32 paymentRef => bool used) public usedPaymentRefs;

    /// @notice Emitted only after a valid intent is paid and treasury receives `amount`.
    /// @dev The ledger should credit from this event only after the indexer's
    ///      confirmation/finality policy is satisfied.
    event DepositReceived(
        bytes32 indexed paymentRef,
        address indexed payer,
        address indexed treasuryRecipient,
        uint256 amount,
        uint256 nonce
    );

    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event IntentSignerSet(address indexed oldSigner, address indexed newSigner);
    event ForcedNativeSwept(address indexed recipient, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroPaymentRef();
    error InvalidTreasury(address treasuryAddress);
    error ExpiredIntent(uint256 deadline);
    error WrongPayer(address caller, address payer);
    error UnexpectedNativeAmount(uint256 expected, uint256 received);
    error PaymentRefAlreadyUsed(bytes32 paymentRef);
    error TreasuryMismatch(address signedTreasury, address currentTreasury);
    error InvalidIntentSignature(address expectedSigner, address recoveredSigner);
    error NativeTransferFailed(address recipient, uint256 amount);
    error DirectNativeTransferDisabled();
    error RenounceDisabled();

    /// @notice Initializes admin, treasury, and backend signer.
    /// @dev Roles are intentionally separate:
    ///      owner changes policy, treasury receives funds, signer authorizes deposits.
    constructor(address initialOwner, address initialTreasury, address initialIntentSigner)
        Ownable(initialOwner)
        EIP712("DepositVault", "1")
    {
        _setTreasury(initialTreasury);
        _setIntentSigner(initialIntentSigner);
    }

    /// @notice Executes a backend-authorized native-asset deposit.
    /// @dev Security shape:
    ///      - caller must be payer, so leaked intents cannot be submitted by others;
    ///      - `msg.value` must exactly equal the signed amount;
    ///      - signature must match the current backend signer;
    ///      - nonce prevents replay;
    ///      - signed treasury must match the current treasury, so treasury rotations
    ///        invalidate stale intents instead of silently redirecting funds;
    ///      - paymentRef uniqueness prevents duplicate settlement under the same business key;
    ///      - native value is forwarded to treasury before receipt emission.
    ///
    ///      Relayer gotcha:
    ///      This intentionally does not support third-party relayers. For relayed
    ///      deposits, remove the `msg.sender == intent.payer` check only after
    ///      adding explicit payer authorization.
    ///
    ///      Overpayment gotcha:
    ///      Overpayment reverts. Do not accept `msg.value >= amount` and refund
    ///      excess; exact payment keeps receipt and ledger semantics simple.
    function deposit(DepositIntent calldata intent, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        if (msg.sender != intent.payer) {
            revert WrongPayer(msg.sender, intent.payer);
        }

        if (intent.paymentRef == bytes32(0)) {
            revert ZeroPaymentRef();
        }

        if (intent.amount == 0) {
            revert ZeroAmount();
        }

        if (msg.value != intent.amount) {
            revert UnexpectedNativeAmount(intent.amount, msg.value);
        }

        if (block.timestamp > intent.deadline) {
            revert ExpiredIntent(intent.deadline);
        }

        if (usedPaymentRefs[intent.paymentRef]) {
            revert PaymentRefAlreadyUsed(intent.paymentRef);
        }

        address recipient = treasury;
        if (intent.treasury != recipient) {
            revert TreasuryMismatch(intent.treasury, recipient);
        }

        address recoveredSigner = _recoverSigner(intent, signature);
        address expectedSigner = intentSigner;

        if (recoveredSigner != expectedSigner) {
            revert InvalidIntentSignature(expectedSigner, recoveredSigner);
        }

        // Consumes exactly the expected per-payer nonce. If forwarding native
        // value later reverts, the whole transaction reverts and the nonce is not consumed.
        _useCheckedNonce(intent.payer, intent.nonce);

        // Mark the business key as settled before the external treasury call.
        // If the treasury call fails, the whole transaction reverts and this write is undone.
        usedPaymentRefs[intent.paymentRef] = true;

        _sendNative(recipient, msg.value);

        emit DepositReceived(intent.paymentRef, intent.payer, recipient, intent.amount, intent.nonce);
    }

    /// @notice Returns the EIP-712 digest signed by the backend for an intent.
    /// @dev Useful for backend integration tests and signature debugging.
    function hashDepositIntent(DepositIntent calldata intent) external view returns (bytes32) {
        return _hashDepositIntent(intent);
    }

    /// @notice Sweeps native value that was forcibly sent to this contract.
    /// @dev This is not a deposit and must not be credited by the ledger. Native value
    ///      can be force-sent by EVM mechanisms that bypass `receive` and `fallback`.
    function sweepForcedNative() external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        if (amount == 0) {
            revert ZeroAmount();
        }

        address recipient = treasury;
        _sendNative(recipient, amount);

        emit ForcedNativeSwept(recipient, amount);
    }

    /// @notice Rejects direct native value transfers.
    /// @dev All creditable payments must go through `deposit` so they have a
    ///      signed intent, nonce, payment reference, and receipt event.
    receive() external payable {
        revert DirectNativeTransferDisabled();
    }

    /// @notice Rejects unknown calls, with or without native value.
    fallback() external payable {
        revert DirectNativeTransferDisabled();
    }

    /// @notice Changes where future deposits are sent.
    /// @dev Needed for treasury migration or compromise response. Already emitted
    ///      deposit receipts are unaffected.
    function setTreasury(address newTreasury) external onlyOwner {
        _setTreasury(newTreasury);
    }

    /// @notice Changes which backend key may authorize future intents.
    /// @dev Use for signer rotation or compromise response. Outstanding intents
    ///      from the old signer stop working immediately.
    function setIntentSigner(address newSigner) external onlyOwner {
        _setIntentSigner(newSigner);
    }

    /// @notice Stops new deposits.
    /// @dev Emergency brake for signer compromise, indexer failure, treasury
    ///      incident, or suspected mismatch between chain events and ledger state.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Restarts deposits after remediation.
    /// @dev Keeps the deployed contract address stable after an incident.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Disabled intentionally.
    /// @dev Renouncing would permanently remove signer rotation, treasury
    ///      rotation, and emergency pause authority.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function _setTreasury(address newTreasury) private {
        if (newTreasury == address(0)) {
            revert ZeroAddress();
        }

        if (newTreasury == address(this)) {
            revert InvalidTreasury(newTreasury);
        }

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasurySet(oldTreasury, newTreasury);
    }

    function _setIntentSigner(address newSigner) private {
        if (newSigner == address(0)) {
            revert ZeroAddress();
        }

        address oldSigner = intentSigner;
        intentSigner = newSigner;

        emit IntentSignerSet(oldSigner, newSigner);
    }

    /// @notice Recovers the backend signer for a deposit intent.
    /// @dev OZ ECDSA rejects malformed signatures and high-s malleable signatures.
    function _recoverSigner(DepositIntent calldata intent, bytes calldata signature) private view returns (address) {
        return ECDSA.recoverCalldata(_hashDepositIntent(intent), signature);
    }

    function _hashDepositIntent(DepositIntent calldata intent) private view returns (bytes32) {
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

        return _hashTypedDataV4(structHash);
    }

    /// @notice Forwards native value and reverts if the recipient rejects it.
    /// @dev Uses `call` rather than `transfer` so treasury may be a multisig or contract wallet.
    function _sendNative(address recipient, uint256 amount) private {
        (bool ok,) = payable(recipient).call{value: amount}("");

        if (!ok) {
            revert NativeTransferFailed(recipient, amount);
        }
    }
}
