pragma solidity 0.8.35;

import {Ownable} from "@openzeppelin-contracts-5.6.1/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin-contracts-5.6.1/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin-contracts-5.6.1/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin-contracts-5.6.1/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin-contracts-5.6.1/utils/ReentrancyGuard.sol";

/// @notice Native-currency channels with persistent cumulative vouchers and one-shot delayed withdrawals.
contract PayToPlay is Ownable2Step, EIP712, ReentrancyGuard {
    struct Channel {
        address payee;
        uint64 claimPeriod;
    }

    struct Position {
        uint256 balance;
        uint256 voucherPaid;
        uint256 requestedAmount;
        uint256 readyAt;
        address voucherKey;
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
        string[] actions;
    }

    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address customer,uint256 channelId,uint256 cumulativeTotal)");

    uint256 public channelCount = 1;
    mapping(uint256 => Channel) private _channels;
    mapping(address => mapping(uint256 => Position)) private _positions;

    error AdminRequired();
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
    event Funded(address indexed customer, uint256 indexed channelId, uint256 amount);
    event VoucherCollected(
        address indexed customer, uint256 indexed channelId, address indexed payee, uint256 amount, uint256 voucherPaid
    );
    event WithdrawalRequested(address indexed customer, uint256 indexed channelId, uint256 amount, uint256 readyAt);
    event Withdrawn(address indexed customer, uint256 indexed channelId, uint256 amount);
    event Moved(address indexed customer, uint256 indexed sourceId, uint256 indexed targetId, uint256 amount);

    constructor(address initialAdmin, uint64 nullClaimPeriod) Ownable(initialAdmin) EIP712("PayToPlay", "1") {
        _channels[0].claimPeriod = nullClaimPeriod;
        emit ChannelCreated(0, address(0), nullClaimPeriod);
    }

    modifier onlyAdmin() {
        if (msg.sender != owner()) revert AdminRequired();
        _;
    }

    function createChannel(address payee, uint64 claimPeriod) external onlyAdmin returns (uint256 channelId) {
        if (payee == address(0)) revert InvalidPayee();
        channelId = channelCount++;
        _channels[channelId] = Channel(payee, claimPeriod);
        emit ChannelCreated(channelId, payee, claimPeriod);
    }

    function setPayee(uint256 channelId, address payee) external onlyAdmin {
        Channel storage definition = _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        if (payee == address(0)) revert InvalidPayee();
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
        _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        if (voucherKey == address(0)) revert InvalidVoucherKey();
        Position storage position = _positions[msg.sender][channelId];
        if (position.voucherKey != address(0)) revert VoucherKeyAlreadyRegistered();
        position.voucherKey = voucherKey;
        emit VoucherKeyRegistered(msg.sender, channelId, voucherKey);
    }

    function fund(uint256 channelId) external payable nonReentrant {
        _channel(channelId);
        if (msg.value == 0) return;
        _positions[msg.sender][channelId].balance += msg.value;
        emit Funded(msg.sender, channelId, msg.value);
    }

    function requestWithdrawal(uint256 channelId, uint256 amount) external nonReentrant {
        Channel storage definition = _channel(channelId);
        Position storage position = _positions[msg.sender][channelId];
        if (position.requestedAmount != 0) return;
        _setWithdrawal(position, channelId, amount, definition.claimPeriod);
    }

    function setWithdrawal(uint256 channelId, uint256 amount) external nonReentrant {
        Channel storage definition = _channel(channelId);
        _setWithdrawal(_positions[msg.sender][channelId], channelId, amount, definition.claimPeriod);
    }

    function withdraw(address customer, uint256 channelId) external nonReentrant returns (uint256 amount) {
        _channel(channelId);
        amount = _consumeWithdrawal(_positions[customer][channelId]);
        _pay(customer, amount);
        emit Withdrawn(customer, channelId, amount);
    }

    function move(uint256 sourceId, uint256 targetId) external nonReentrant returns (uint256 amount) {
        _channel(sourceId);
        _channel(targetId);
        if (sourceId == targetId) revert SameChannel();
        amount = _consumeWithdrawal(_positions[msg.sender][sourceId]);
        _positions[msg.sender][targetId].balance += amount;
        emit Moved(msg.sender, sourceId, targetId, amount);
    }

    function collect(address customer, uint256 channelId, uint256 cumulativeTotal, bytes calldata signature)
        external
        nonReentrant
        returns (uint256 amount)
    {
        Channel storage definition = _channel(channelId);
        if (channelId == 0) revert NullChannelCannotCollect();
        Position storage position = _positions[customer][channelId];
        address voucherKey = position.voucherKey;
        if (voucherKey == address(0)) revert VoucherKeyNotRegistered();
        (address recovered, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(voucherDigest(customer, channelId, cumulativeTotal), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != voucherKey) revert InvalidVoucherSignature();
        if (cumulativeTotal <= position.voucherPaid) return 0;
        amount = _min(cumulativeTotal - position.voucherPaid, position.balance);
        if (amount == 0) return 0;
        position.balance -= amount;
        position.voucherPaid += amount;
        address payee = definition.payee;
        _pay(payee, amount);
        emit VoucherCollected(customer, channelId, payee, amount, position.voucherPaid);
    }

    function voucherDigest(address customer, uint256 channelId, uint256 cumulativeTotal) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, customer, channelId, cumulativeTotal)));
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
        view_.actions = _actions(customer, channelId, actor, position);
    }

    function _actions(address customer, uint256 channelId, address actor, Position storage position)
        private
        view
        returns (string[] memory actions)
    {
        string[8] memory available;
        uint256 count;
        bool ownPosition = actor != address(0) && actor == customer;
        bool mature = position.requestedAmount != 0 && block.timestamp >= position.readyAt;
        if (ownPosition) available[count++] = "fund";
        if (ownPosition && position.balance != 0) {
            if (position.requestedAmount == 0) available[count++] = "requestWithdrawal";
            available[count++] = "setWithdrawal";
        }
        if (mature) {
            available[count++] = "withdraw";
            if (ownPosition && channelCount > 1) available[count++] = "move";
        }
        if (channelId != 0) {
            if (position.voucherKey != address(0)) available[count++] = "collect";
            else if (ownPosition) available[count++] = "registerVoucherKey";
        }
        if (actor == owner() && actor != address(0)) {
            available[count++] = "createChannel";
            if (channelId != 0) available[count++] = "setPayee";
        }
        actions = new string[](count);
        for (uint256 i = 0; i < count; i++) {
            actions[i] = available[i];
        }
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
