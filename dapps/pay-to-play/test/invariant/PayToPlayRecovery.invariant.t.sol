pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";
import {PayToPlay} from "../../src/PayToPlay.sol";

/// @dev Multiple real-key customers share channels; every generated operation preserves voucher history.
contract PayToPlayRecoveryHandler is Test {
    uint256 private constant KEY = uint256(keccak256("public recovery invariant fixture key"));
    PayToPlay public payments;
    address[2] public customers;
    address public voucherKey;
    uint256 public funded;
    uint256 public collected;
    uint256 public withdrawn;
    uint256 public refunded;
    mapping(uint256 => uint256) public firstCloseAt;
    mapping(address => mapping(uint256 => uint256)) public actuallyPaid;

    constructor() {
        payments = new PayToPlay(address(this), 100);
        payments.createChannel(makeAddr("recovery payee one"), 100);
        payments.createChannel(makeAddr("recovery payee two"), 100);
        customers[0] = makeAddr("recovery customer one");
        customers[1] = makeAddr("recovery customer two");
        voucherKey = vm.addr(KEY);
        for (uint256 i = 0; i < 2; i++) {
            vm.startPrank(customers[i]);
            payments.registerVoucherKey(1, voucherKey);
            payments.registerVoucherKey(2, voucherKey);
            vm.stopPrank();
        }
    }

    function fund(uint8 who, uint8 channel, uint96 rawAmount) external {
        address customer = customers[who % 2];
        uint256 id = channel % 3;
        if (_view(customer, id).phase != PayToPlay.Phase.Operating) return;
        uint256 amount = bound(rawAmount, 0, 1 ether);
        vm.deal(customer, customer.balance + amount);
        vm.prank(customer);
        payments.fund{value: amount}(id);
        funded += amount;
    }

    function collect(uint8 who, uint8 channel, uint96 total) external {
        address customer = customers[who % 2];
        uint256 id = 1 + channel % 2;
        if (_view(customer, id).phase == PayToPlay.Phase.RefundOnly) return;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(KEY, payments.voucherDigest(customer, id, total));
        uint256 amount = payments.collect(customer, id, total, abi.encodePacked(r, s, v));
        collected += amount;
        actuallyPaid[customer][id] += amount;
    }

    function request(uint8 who, uint8 channel, uint96 rawAmount) external {
        address customer = customers[who % 2];
        uint256 id = channel % 3;
        PayToPlay.PositionView memory position = _view(customer, id);
        if (position.phase != PayToPlay.Phase.Operating || position.balance == 0) return;
        vm.prank(customer);
        payments.setWithdrawal(id, bound(rawAmount, 1, position.balance));
    }

    function withdraw(uint8 who, uint8 channel) external {
        address customer = customers[who % 2];
        uint256 id = channel % 3;
        PayToPlay.PositionView memory position = _view(customer, id);
        if (position.requestedAmount == 0 || block.timestamp < position.readyAt) return;
        withdrawn += payments.withdraw(customer, id);
    }

    function move(uint8 who, uint8 rawSource, uint8 rawTarget) external {
        address customer = customers[who % 2];
        uint256 source = rawSource % 3;
        uint256 target = rawTarget % 3;
        PayToPlay.PositionView memory position = _view(customer, source);
        if (source == target || position.requestedAmount == 0 || block.timestamp < position.readyAt) return;
        if (_view(customer, target).phase != PayToPlay.Phase.Operating) return;
        vm.prank(customer);
        payments.move(source, target);
    }

    function closePosition(uint8 who, uint8 channel) external {
        payments.closePosition(customers[who % 2], channel % 3);
    }

    function closeChannel(uint8 rawChannel) external {
        // Keep permanent closure infrequent enough to explore reusable funding cycles too.
        if (rawChannel % 16 != 0) return;
        uint256 id = (rawChannel / 16) % 3;
        payments.closeChannel(id);
        if (firstCloseAt[id] == 0) firstCloseAt[id] = payments.channel(id).closeAt;
    }

    function renew(uint8 who, uint8 channel) external {
        address customer = customers[who % 2];
        uint256 id = channel % 3;
        PayToPlay.PositionView memory position = _view(customer, id);
        if (position.phase != PayToPlay.Phase.Operating || position.scheduledRefundAt == 0) return;
        vm.prank(customer);
        payments.renewPosition(id);
    }

    function refund(uint8 who, uint8 channel) external {
        address customer = customers[who % 2];
        uint256 id = channel % 3;
        if (_view(customer, id).phase != PayToPlay.Phase.RefundOnly) return;
        refunded += payments.refund(customer, id);
    }

    function advanceTime(uint32 elapsed) external {
        uint256 delta = elapsed % 16 == 0 ? 365 days + uint256(elapsed % 201) : elapsed % 201;
        vm.warp(block.timestamp + delta);
    }

    function _view(address customer, uint256 channel) private view returns (PayToPlay.PositionView memory) {
        return payments.viewPosition(customer, channel, customer);
    }
}

contract PayToPlayRecoveryInvariantTest is Test {
    PayToPlayRecoveryHandler private handler;
    PayToPlay private payments;

    function setUp() public {
        handler = new PayToPlayRecoveryHandler();
        payments = handler.payments();
        handler.fund(0, 1, 100);
        handler.fund(1, 2, 100);
        bytes4[] memory selectors = new bytes4[](10);
        selectors[0] = PayToPlayRecoveryHandler.fund.selector;
        selectors[1] = PayToPlayRecoveryHandler.collect.selector;
        selectors[2] = PayToPlayRecoveryHandler.request.selector;
        selectors[3] = PayToPlayRecoveryHandler.withdraw.selector;
        selectors[4] = PayToPlayRecoveryHandler.move.selector;
        selectors[5] = PayToPlayRecoveryHandler.closePosition.selector;
        selectors[6] = PayToPlayRecoveryHandler.closeChannel.selector;
        selectors[7] = PayToPlayRecoveryHandler.renew.selector;
        selectors[8] = PayToPlayRecoveryHandler.refund.selector;
        selectors[9] = PayToPlayRecoveryHandler.advanceTime.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantFundsKeysAndPermanentClosureSurviveAllInterleavings() external view {
        uint256 held;
        uint256 paid;
        for (uint256 id = 0; id < 3; id++) {
            uint256 channelBalance;
            PayToPlay.Channel memory channel = payments.channel(id);
            assertEq(channel.closeAt, handler.firstCloseAt(id));
            for (uint256 i = 0; i < 2; i++) {
                address customer = handler.customers(i);
                PayToPlay.PositionView memory position = payments.viewPosition(customer, id, customer);
                channelBalance += position.balance;
                paid += position.voucherPaid;
                assertEq(position.voucherKey, id == 0 ? address(0) : handler.voucherKey());
                assertEq(position.voucherPaid, handler.actuallyPaid(customer, id));
                if (channel.closeAt != 0) assertTrue(position.phase != PayToPlay.Phase.Operating);
                if (position.refundAt != 0 && block.timestamp >= position.refundAt) {
                    assertEq(uint256(position.phase), uint256(PayToPlay.Phase.RefundOnly));
                }
            }
            assertEq(channelBalance, channel.escrowTotal);
            held += channelBalance;
        }
        assertEq(held, address(payments).balance);
        assertEq(paid, handler.collected());
        assertEq(held + handler.collected() + handler.withdrawn() + handler.refunded(), handler.funded());
    }
}
