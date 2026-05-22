pragma solidity 0.8.35;

import {IERC20} from "@openzeppelin-contracts-5.6.1/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin-contracts-5.6.1/token/ERC20/utils/SafeERC20.sol";

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin-contracts-5.6.1/access/Ownable2Step.sol";

import {Pausable} from "@openzeppelin-contracts-5.6.1/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin-contracts-5.6.1/utils/ReentrancyGuard.sol";
import {Nonces} from "@openzeppelin-contracts-5.6.1/utils/Nonces.sol";

import {EIP712} from "@openzeppelin-contracts-5.6.1/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin-contracts-5.6.1/utils/cryptography/ECDSA.sol";

/// @notice Minimal ERC-20 deposit gateway for off-chain credit accounting.
/// @dev This contract is deliberately not a ledger. It verifies backend-signed
///      intents, moves tokens to treasury, and emits events for an off-chain indexer.
///
///      Backend requirements:
///      - store payment intents durably before returning signatures to users;
///      - enforce `unique(contract_address, payer, nonce)`;
///      - for the minimal product, allow at most one active unpaid intent per payer;
///      - read `nonces(payer)` before signing the next intent;
///      - do not sign intents for fee-on-transfer, rebasing, or unreviewed tokens.
///
///      Indexer requirements:
///      - credit only confirmed `DepositReceived` events;
///      - dedupe by `(chainId, contract, txHash, logIndex)`;
///      - treat `paymentRef` as a business/accounting key, not an event ID;
///      - handle reorgs before final ledger settlement.
contract DepositVault is Ownable2Step, Pausable, ReentrancyGuard, EIP712, Nonces {
    using SafeERC20 for IERC20;

    /// @notice Backend-authorized deposit instruction.
    /// @dev `paymentRef` links the payment to off-chain accounting.
    ///
    ///      Nonce gotcha:
    ///      `nonce` is strict and per payer. For a given payer, only the next
    ///      contract nonce can succeed. Multiple live intents with the same
    ///      `(contract, payer, nonce)` create a race where only one can settle.
    ///
    ///      Domain gotcha:
    ///      EIP-712 binds the signature to this chain and this deployed vault.
    struct DepositIntent {
        bytes32 paymentRef;
        address payer;
        address token;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    bytes32 private constant DEPOSIT_INTENT_TYPEHASH = keccak256(
        "DepositIntent(bytes32 paymentRef,address payer,address token,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @notice Destination that receives all deposited tokens immediately.
    /// @dev Use a multisig or hardened treasury wallet. This contract should not
    ///      custody user balances.
    address public treasury;

    /// @notice Backend-controlled ECDSA signer that authorizes deposit intents.
    /// @dev This is intended to be an EOA/HSM-style signing key. If a Safe or
    ///      ERC-1271 contract signer is required later, replace ECDSA recovery
    ///      with OZ SignatureChecker and re-review the call/revocation semantics.
    address public intentSigner;

    /// @notice ERC-20 allowlist.
    /// @dev Keep this narrow. The exact treasury balance-delta check intentionally
    ///      rejects fee-on-transfer, rebasing, and other non-exact token behavior.
    mapping(address token => bool allowed) public allowedToken;

    /// @notice Emitted after a valid intent is paid and treasury receives exactly `amount`.
    /// @dev The off-chain ledger should credit from this event only after the
    ///      indexer’s chosen confirmation/finality policy is satisfied.
    event DepositReceived(
        bytes32 indexed paymentRef, address indexed payer, address indexed token, uint256 amount, uint256 nonce
    );

    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event IntentSignerSet(address indexed oldSigner, address indexed newSigner);
    event TokenAllowedSet(address indexed token, bool allowed);

    error ZeroAddress();
    error ZeroAmount();
    error ZeroPaymentRef();
    error TokenHasNoCode(address token);
    error TokenNotAllowed(address token);
    error ExpiredIntent(uint256 deadline);
    error WrongPayer(address caller, address payer);
    error InvalidIntentSigner(address recoveredSigner);
    error UnexpectedReceivedAmount(address token, uint256 expected, uint256 received);
    error RenounceDisabled();

    /// @notice Initializes admin, treasury, and backend signer.
    /// @dev Roles are intentionally separate:
    ///      owner changes policy, treasury receives funds, signer authorizes deposits.
    constructor(address initialOwner, address initialTreasury, address initialIntentSigner)
        Ownable(initialOwner)
        EIP712("DepositVault", "1")
    {
        if (initialTreasury == address(0)) {
            revert ZeroAddress();
        }

        if (initialIntentSigner == address(0)) {
            revert ZeroAddress();
        }

        treasury = initialTreasury;
        intentSigner = initialIntentSigner;

        emit TreasurySet(address(0), initialTreasury);
        emit IntentSignerSet(address(0), initialIntentSigner);
    }

    /// @notice Executes a backend-authorized ERC-20 deposit.
    /// @dev Security shape:
    ///      - caller must be payer, so leaked intents cannot be submitted by others;
    ///      - signature must match the current backend signer;
    ///      - nonce prevents replay;
    ///      - exact treasury balance delta prevents ledger over-crediting;
    ///      - event is emitted only after funds arrive.
    ///
    ///      Relayer gotcha:
    ///      This intentionally does not support third-party relayers. For relayed
    ///      deposits, remove the `msg.sender == intent.payer` check only after
    ///      adding an explicit payer authorization model.
    ///
    ///      Approval gotcha:
    ///      The payer must approve this contract for at least `intent.amount`
    ///      before calling `deposit`.
    function deposit(DepositIntent calldata intent, bytes calldata signature) external nonReentrant whenNotPaused {
        if (msg.sender != intent.payer) {
            revert WrongPayer(msg.sender, intent.payer);
        }

        if (intent.paymentRef == bytes32(0)) {
            revert ZeroPaymentRef();
        }

        if (intent.amount == 0) {
            revert ZeroAmount();
        }

        if (!allowedToken[intent.token]) {
            revert TokenNotAllowed(intent.token);
        }

        if (block.timestamp > intent.deadline) {
            revert ExpiredIntent(intent.deadline);
        }

        address recoveredSigner = _recoverSigner(intent, signature);

        if (recoveredSigner != intentSigner) {
            revert InvalidIntentSigner(recoveredSigner);
        }

        // Consumes exactly the expected per-payer nonce. If any later operation
        // reverts, the whole transaction reverts and the nonce is not consumed.
        _useCheckedNonce(intent.payer, intent.nonce);

        IERC20 token = IERC20(intent.token);

        // Balance-delta accounting is deliberate: the emitted amount must match
        // what treasury actually received, or the off-chain ledger can over-credit.
        // This assumes reviewed, plain ERC-20s with exact transfer semantics.
        uint256 beforeBalance = token.balanceOf(treasury);

        token.safeTransferFrom(intent.payer, treasury, intent.amount);

        uint256 afterBalance = token.balanceOf(treasury);

        if (afterBalance < beforeBalance) {
            revert UnexpectedReceivedAmount(intent.token, intent.amount, 0);
        }

        uint256 received = afterBalance - beforeBalance;

        if (received != intent.amount) {
            revert UnexpectedReceivedAmount(intent.token, intent.amount, received);
        }

        emit DepositReceived(intent.paymentRef, intent.payer, intent.token, intent.amount, intent.nonce);
    }

    /// @notice Changes where future deposits are sent.
    /// @dev Needed for treasury migration or compromise response.
    ///      Already emitted deposit events are unaffected.
    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) {
            revert ZeroAddress();
        }

        address oldTreasury = treasury;
        treasury = newTreasury;

        emit TreasurySet(oldTreasury, newTreasury);
    }

    /// @notice Changes which backend key may authorize future intents.
    /// @dev Use for signer rotation or compromise response. Outstanding intents
    ///      from the old signer stop working immediately.
    function setIntentSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) {
            revert ZeroAddress();
        }

        address oldSigner = intentSigner;
        intentSigner = newSigner;

        emit IntentSignerSet(oldSigner, newSigner);
    }

    /// @notice Enables or disables a token for future deposits.
    /// @dev Code-size check catches accidental EOA allowlisting. It does not
    ///      prove the token is safe; token behavior must be reviewed off-chain.
    function setAllowedToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) {
            revert ZeroAddress();
        }

        if (allowed && token.code.length == 0) {
            revert TokenHasNoCode(token);
        }

        allowedToken[token] = allowed;

        emit TokenAllowedSet(token, allowed);
    }

    /// @notice Stops new deposits.
    /// @dev Emergency brake for signer compromise, token incident, indexer
    ///      failure, or suspected mismatch between chain events and ledger state.
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
    ///      rotation, token allowlist management, and emergency pause.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @notice Recovers the backend signer for a deposit intent.
    /// @dev Isolated to keep the payment path readable. OZ ECDSA rejects
    ///      malformed signatures and high-s malleable signatures.
    function _recoverSigner(DepositIntent calldata intent, bytes calldata signature) private view returns (address) {
        bytes32 structHash = keccak256(
            abi.encode(
                DEPOSIT_INTENT_TYPEHASH,
                intent.paymentRef,
                intent.payer,
                intent.token,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );

        return ECDSA.recover(_hashTypedDataV4(structHash), signature);
    }
}
