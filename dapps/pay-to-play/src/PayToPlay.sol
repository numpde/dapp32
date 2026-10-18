pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin-contracts-5.6.1/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin-contracts-5.6.1/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin-contracts-5.6.1/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin-contracts-5.6.1/utils/ReentrancyGuard.sol";

/// @notice Native-currency channels with permanent voucher keys, delayed withdrawals and bounded recovery.
contract PayToPlay is Ownable2Step, EIP712, ReentrancyGuard {
    uint256 public constant RECOVERY_HORIZON = 365 days;
    uint64 public constant MAX_CLAIM_PERIOD = 30 days;

    enum Phase {
        Operating,
        Settling,
        RefundOnly
    }

    struct Channel {
        address payee;
        uint64 claimPeriod;
        uint256 closeAt;
        uint256 escrowTotal;
    }

    struct Position {
        uint256 balance;
        uint256 voucherPaid;
        uint256 requestedAmount;
        uint256 readyAt;
        address voucherKey;
        uint256 refundAt;
        address refundRecipient;
    }

    struct PositionView {
        address customer;
        uint256 channelId;
        address payee;
        uint64 claimPeriod;
        uint256 channelCount;
        address admin;
        uint256 balance;
        uint256 voucherPaid;
        uint256 requestedAmount;
        uint256 readyAt;
        uint256 effectiveBalance;
        address voucherKey;
        uint256 scheduledRefundAt;
        uint256 refundAt;
        uint256 settleAt;
        uint256 closeAt;
        uint256 escrowTotal;
        address refundRecipient;
        Phase phase;
        string[] actions;
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address customer,uint256 channelId,uint256 cumulativeTotal,bytes32 invoiceHash)");

    uint256 public channelCount = 1;
    mapping(uint256 => Channel) private _channels;
    mapping(address => mapping(uint256 => Position)) private _positions;

    error AdminRequired();
    error ClosureAuthorityRequired();
    error ClaimPeriodTooLong(uint64 claimPeriod);
    error PositionNotOperating();
    error ChannelClosed();
    error RecoveryNotScheduled();
    error RefundNotReady(uint256 refundAt);
    error VoucherCollectionEnded(uint256 refundAt);
    error InvalidRefundRecipient();
    error ChannelNotFound(uint256 channelId);
    error InvalidPayee();
    error NullChannelCannotCollect();
    error InvalidVoucherSignature();
    error InvalidVoucherKey();
    error VoucherKeyAlreadyRegistered();
    error VoucherKeyNotRegistered();
    error InvalidWithdrawalAmount(uint256 requested, uint256 balance);
    error WithdrawalNotRequested();
    error WithdrawalNotReady(uint256 readyAt);
    error SameChannel();
    error NativePaymentFailed(address recipient, uint256 amount);

    event ChannelCreated(uint256 indexed channelId, address payee, uint64 claimPeriod);
    event PayeeChanged(uint256 indexed channelId, address previousPayee, address payee);
    event VoucherKeyRegistered(address indexed customer, uint256 indexed channelId, address indexed voucherKey);
    event PositionRenewed(address indexed customer, uint256 indexed channelId, uint256 refundAt);
    event PositionClosing(address indexed customer, uint256 indexed channelId, uint256 refundAt);
    event ChannelClosing(uint256 indexed channelId, uint256 closeAt);
    event RefundRecipientChanged(address indexed customer, uint256 indexed channelId, address recipient);
    event Refunded(address indexed customer, uint256 indexed channelId, address indexed recipient, uint256 amount);
    event Funded(address indexed customer, uint256 indexed channelId, uint256 amount);
    /// @notice invoiceHash identifies the submitted voucher's reference, not allocation of this payment to an invoice.
    event VoucherCollected(
        address indexed customer,
        uint256 indexed channelId,
        address indexed payee,
        uint256 amount,
        uint256 voucherPaid,
        bytes32 invoiceHash
    );
    event WithdrawalRequested(address indexed customer, uint256 indexed channelId, uint256 amount, uint256 readyAt);
    event Withdrawn(address indexed customer, uint256 indexed channelId, uint256 amount);
    event Moved(address indexed customer, uint256 indexed sourceId, uint256 indexed targetId, uint256 amount);

    constructor(address initialAdmin, uint64 nullClaimPeriod) Ownable(initialAdmin) EIP712("PayToPlay", "2") {
        _validateClaimPeriod(nullClaimPeriod);
        _channels[0].claimPeriod = nullClaimPeriod;
        emit ChannelCreated(0, address(0), nullClaimPeriod);
    }

    modifier onlyAdmin() {
        if (msg.sender != owner()) revert AdminRequired();
        _;
    }

    function createChannel(address payee, uint64 claimPeriod) external onlyAdmin returns (uint256 channelId) {
        if (payee == address(0)) revert InvalidPayee();
        _validateClaimPeriod(claimPeriod);
        channelId = channelCount++;
        _channels[channelId] = Channel(payee, claimPeriod, 0, 0);
        emit ChannelCreated(channelId, payee, claimPeriod);
    }

    function setPayee(uint256 channelId, address payee) external onlyAdmin {
        Channel storage definition = _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        if (payee == address(0)) revert InvalidPayee();
        if (definition.closeAt != 0 && block.timestamp >= definition.closeAt) revert ChannelClosed();
        address previous = definition.payee;
        definition.payee = payee;
        emit PayeeChanged(channelId, previous, payee);
    }

    function channel(uint256 channelId) external view returns (Channel memory) {
        return _channel(channelId);
    }

    /// @notice Permanently authorize one ECDSA key for the caller's position; no rotation or revocation.
    /// @dev Wallet code is never consulted. Funding, withdrawals and moves do not reset this key.
    function registerVoucherKey(uint256 channelId, address voucherKey) external nonReentrant {
        Channel storage definition = _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        if (voucherKey == address(0)) revert InvalidVoucherKey();
        Position storage position = _positions[msg.sender][channelId];
        _requireOperating(definition, position);
        if (position.voucherKey != address(0)) revert VoucherKeyAlreadyRegistered();
        position.voucherKey = voucherKey;
        emit VoucherKeyRegistered(msg.sender, channelId, voucherKey);
    }

    function fund(uint256 channelId) external payable nonReentrant {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[msg.sender][channelId];
        _requireOperating(definition, position);
        if (msg.value == 0) return;
        position.balance += msg.value;
        definition.escrowTotal += msg.value;
        _renew(position, channelId, definition.claimPeriod);
        emit Funded(msg.sender, channelId, msg.value);
    }

    /// @notice Extend an active funding cycle, without changing withdrawal or voucher rights.
    function renewPosition(uint256 channelId) external nonReentrant {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[msg.sender][channelId];
        _requireOperating(definition, position);
        if (position.refundAt == 0) revert RecoveryNotScheduled();
        _renew(position, channelId, definition.claimPeriod);
    }

    /// @notice Begin an irreversible wind-down of the current funding cycle; never postpone an exit.
    function closePosition(address customer, uint256 channelId) external nonReentrant {
        Channel storage definition = _channel(channelId);
        if (msg.sender != customer && !_channelOperator(definition, msg.sender)) revert ClosureAuthorityRequired();
        Position storage position = _positions[customer][channelId];
        if (position.refundAt == 0) return;
        uint256 deadline = block.timestamp + uint256(definition.claimPeriod);
        // An annual or channel-wide settlement already in progress must not restart.
        uint256 currentDeadline = _refundAt(definition, position);
        if (deadline >= currentDeadline) return;
        position.refundAt = deadline;
        emit PositionClosing(customer, channelId, deadline);
    }

    /// @notice Retire a channel permanently. No customer iteration and no external payment.
    function closeChannel(uint256 channelId) external nonReentrant {
        Channel storage definition = _channel(channelId);
        if (!_channelOperator(definition, msg.sender)) revert ClosureAuthorityRequired();
        if (definition.closeAt != 0) return;
        definition.closeAt = block.timestamp + uint256(definition.claimPeriod);
        emit ChannelClosing(channelId, definition.closeAt);
    }

    /// @notice Set the destination for full refunds only; the balance owner retains this authority.
    function setRefundRecipient(uint256 channelId, address recipient) external nonReentrant {
        _channel(channelId);
        if (recipient == address(0) || recipient == address(this)) revert InvalidRefundRecipient();
        _positions[msg.sender][channelId].refundRecipient = recipient;
        emit RefundRecipientChanged(msg.sender, channelId, recipient);
    }

    /// @notice Anyone may return a due balance, but cannot choose the recipient.
    /// @dev A failed payment rolls back all effects. Successful zero refunds may end an empty cycle.
    function refund(address customer, uint256 channelId) external nonReentrant returns (uint256 amount) {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[customer][channelId];
        uint256 deadline = _refundAt(definition, position);
        if (deadline == 0) revert RecoveryNotScheduled();
        if (block.timestamp < deadline) revert RefundNotReady(deadline);
        amount = position.balance;
        address recipient = _refundRecipient(customer, position);
        position.balance = 0;
        position.requestedAmount = 0;
        position.readyAt = 0;
        position.refundAt = 0;
        definition.escrowTotal -= amount;
        _pay(recipient, amount);
        emit Refunded(customer, channelId, recipient, amount);
    }

    function requestWithdrawal(uint256 channelId, uint256 amount) external nonReentrant {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[msg.sender][channelId];
        if (position.requestedAmount != 0) return;
        _requireOperating(definition, position);
        _setWithdrawal(position, channelId, amount, definition.claimPeriod);
    }

    function setWithdrawal(uint256 channelId, uint256 amount) external nonReentrant {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[msg.sender][channelId];
        _requireOperating(definition, position);
        _setWithdrawal(position, channelId, amount, definition.claimPeriod);
    }

    function withdraw(address customer, uint256 channelId) external nonReentrant returns (uint256 amount) {
        Channel storage definition = _channel(channelId);
        amount = _consumeWithdrawal(_positions[customer][channelId]);
        definition.escrowTotal -= amount;
        _pay(customer, amount);
        emit Withdrawn(customer, channelId, amount);
    }

    function move(uint256 sourceId, uint256 targetId) external nonReentrant returns (uint256 amount) {
        Channel storage source = _channel(sourceId);
        Channel storage target = _channel(targetId);
        if (sourceId == targetId) revert SameChannel();
        Position storage destination = _positions[msg.sender][targetId];
        _requireOperating(target, destination);
        amount = _consumeWithdrawal(_positions[msg.sender][sourceId]);
        if (amount != 0) {
            source.escrowTotal -= amount;
            target.escrowTotal += amount;
            destination.balance += amount;
            _renew(destination, targetId, target.claimPeriod);
        }
        emit Moved(msg.sender, sourceId, targetId, amount);
    }

    /// @notice Collect a cumulative entitlement, authenticating an opaque invoice reference.
    /// @dev No invoice storage, uniqueness, expiry, allocation or fulfillment rules are enforced here.
    function collect(
        address customer,
        uint256 channelId,
        uint256 cumulativeTotal,
        bytes32 invoiceHash,
        bytes calldata signature
    ) external nonReentrant returns (uint256 amount) {
        Channel storage definition = _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        Position storage position = _positions[customer][channelId];
        {
            uint256 deadline = _refundAt(definition, position);
            if (deadline != 0 && block.timestamp >= deadline) revert VoucherCollectionEnded(deadline);
        }
        {
            address voucherKey = position.voucherKey;
            if (voucherKey == address(0)) revert VoucherKeyNotRegistered();
            (address recovered, ECDSA.RecoverError err,) =
                ECDSA.tryRecover(voucherDigest(customer, channelId, cumulativeTotal, invoiceHash), signature);
            if (err != ECDSA.RecoverError.NoError || recovered != voucherKey) revert InvalidVoucherSignature();
        }
        if (cumulativeTotal <= position.voucherPaid) return 0;
        amount = _min(cumulativeTotal - position.voucherPaid, position.balance);
        if (amount == 0) return 0;
        position.balance -= amount;
        position.voucherPaid += amount;
        definition.escrowTotal -= amount;
        address payee = definition.payee;
        _pay(payee, amount);
        emit VoucherCollected(customer, channelId, payee, amount, position.voucherPaid, invoiceHash);
    }

    function voucherDigest(address customer, uint256 channelId, uint256 cumulativeTotal, bytes32 invoiceHash)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, customer, channelId, cumulativeTotal, invoiceHash)));
    }

    /// @notice One snapshot owns action availability for the inspected position and acting account.
    function viewPosition(address customer, uint256 channelId, address actor)
        external
        view
        returns (PositionView memory view_)
    {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[customer][channelId];
        view_.customer = customer;
        view_.channelId = channelId;
        view_.payee = definition.payee;
        view_.claimPeriod = definition.claimPeriod;
        view_.channelCount = channelCount;
        view_.admin = owner();
        view_.balance = position.balance;
        view_.voucherPaid = position.voucherPaid;
        view_.voucherKey = position.voucherKey;
        view_.requestedAmount = position.requestedAmount;
        view_.readyAt = position.readyAt;
        view_.effectiveBalance =
            position.balance > position.requestedAmount ? position.balance - position.requestedAmount : 0;
        view_.scheduledRefundAt = position.refundAt;
        view_.refundAt = _refundAt(definition, position);
        view_.settleAt = view_.refundAt == 0 ? 0 : view_.refundAt - uint256(definition.claimPeriod);
        view_.closeAt = definition.closeAt;
        view_.escrowTotal = definition.escrowTotal;
        view_.refundRecipient = _refundRecipient(customer, position);
        view_.phase = _phase(definition, position);
        view_.actions = _actions(customer, channelId, actor, definition, position);
    }

    function _actions(
        address customer,
        uint256 channelId,
        address actor,
        Channel storage definition,
        Position storage position
    ) private view returns (string[] memory actions) {
        string[16] memory available;
        uint256 count;
        bool ownPosition = actor != address(0) && actor == customer;
        Phase phase = _phase(definition, position);
        bool operating = phase == Phase.Operating;
        bool operator = _channelOperator(definition, actor);
        bool mature = position.requestedAmount != 0 && block.timestamp >= position.readyAt;
        if (ownPosition) {
            available[count++] = "setRefundRecipient";
            if (operating) {
                available[count++] = "fund";
                if (position.refundAt != 0) available[count++] = "renewPosition";
                if (position.balance != 0) {
                    if (position.requestedAmount == 0) available[count++] = "requestWithdrawal";
                    available[count++] = "setWithdrawal";
                }
            }
        }
        if (mature) {
            available[count++] = "withdraw";
            if (ownPosition && channelCount > 1) available[count++] = "move";
        }
        if (channelId != 0) {
            if (position.voucherKey != address(0) && phase != Phase.RefundOnly) {
                available[count++] = "collect";
            } else if (position.voucherKey == address(0) && ownPosition && operating) {
                available[count++] = "registerVoucherKey";
            }
        }
        if ((ownPosition || operator) && operating && position.refundAt != 0) {
            available[count++] = "closePosition";
        }
        if (
            phase == Phase.RefundOnly
                && (position.balance != 0 || position.refundAt != 0 || position.requestedAmount != 0)
        ) {
            available[count++] = "refund";
        }
        if (operator && definition.closeAt == 0) available[count++] = "closeChannel";
        if (actor == owner() && actor != address(0)) {
            available[count++] = "createChannel";
            if (channelId != 0 && (definition.closeAt == 0 || block.timestamp < definition.closeAt)) {
                available[count++] = "setPayee";
            }
        }
        actions = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            actions[i] = available[i];
        }
    }

    function _validateClaimPeriod(uint64 period) private pure {
        if (period > MAX_CLAIM_PERIOD) revert ClaimPeriodTooLong(period);
    }

    function _channelOperator(Channel storage definition, address actor) private view returns (bool) {
        return actor != address(0) && (actor == owner() || actor == definition.payee);
    }

    function _refundAt(Channel storage definition, Position storage position) private view returns (uint256) {
        uint256 scheduled = position.refundAt;
        uint256 closing = definition.closeAt;
        if (scheduled == 0) return closing;
        if (closing == 0) return scheduled;
        return _min(scheduled, closing);
    }

    function _phase(Channel storage definition, Position storage position) private view returns (Phase) {
        uint256 deadline = _refundAt(definition, position);
        if (deadline == 0) return Phase.Operating;
        if (block.timestamp >= deadline) return Phase.RefundOnly;
        if (block.timestamp >= deadline - uint256(definition.claimPeriod)) return Phase.Settling;
        return Phase.Operating;
    }

    function _requireOperating(Channel storage definition, Position storage position) private view {
        if (_phase(definition, position) != Phase.Operating) revert PositionNotOperating();
    }

    function _renew(Position storage position, uint256 channelId, uint64 period) private {
        uint256 deadline = block.timestamp + RECOVERY_HORIZON + uint256(period);
        if (deadline <= position.refundAt) return;
        position.refundAt = deadline;
        emit PositionRenewed(msg.sender, channelId, deadline);
    }

    function _refundRecipient(address customer, Position storage position) private view returns (address) {
        return position.refundRecipient == address(0) ? customer : position.refundRecipient;
    }

    function _channel(uint256 channelId) private view returns (Channel storage definition) {
        if (channelId >= channelCount) revert ChannelNotFound(channelId);
        return _channels[channelId];
    }

    function _setWithdrawal(Position storage position, uint256 channelId, uint256 amount, uint64 period) private {
        if (amount == 0 || amount > position.balance) revert InvalidWithdrawalAmount(amount, position.balance);
        position.requestedAmount = amount;
        position.readyAt = block.timestamp + uint256(period);
        emit WithdrawalRequested(msg.sender, channelId, amount, position.readyAt);
    }

    function _consumeWithdrawal(Position storage position) private returns (uint256 amount) {
        if (position.requestedAmount == 0) revert WithdrawalNotRequested();
        if (block.timestamp < position.readyAt) revert WithdrawalNotReady(position.readyAt);
        amount = _min(position.requestedAmount, position.balance);
        position.balance -= amount;
        position.requestedAmount = 0;
        position.readyAt = 0;
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativePaymentFailed(recipient, amount);
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
