pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {PayToPlay} from "../../src/PayToPlay.sol";

// A contract customer registers a fixed fixture key and signs generated totals.
// Authorization is independent of the customer contract's signature policy.
contract PayToPlayHandler is Test {
    uint256 private constant VOUCHER_KEY = uint256(keccak256("pay-to-play invariant voucher key"));
    PayToPlay public payments;
    address public immutable voucherKey;
    uint256 public totalFunded;
    uint256 public totalWithdrawn;
    uint256 public totalCollected;
    uint256 public successfulMoves;

    constructor(PayToPlay app) {
        payments = app;
        voucherKey = vm.addr(VOUCHER_KEY);
        payments.registerVoucherKey(1, voucherKey);
        payments.registerVoucherKey(2, voucherKey);
    }

    receive() external payable {}

    function fund(uint8 rawChannel, uint96 rawAmount) external {
        uint256 amount = bound(rawAmount, 0, 1 ether);
        payments.fund{value: amount}(rawChannel % 3);
        totalFunded += amount;
    }

    function request(uint8 rawChannel, uint96 rawAmount, bool renew) external {
        uint256 id = rawChannel % 3;
        PayToPlay.PositionView memory position = payments.viewPosition(address(this), id, address(this));
        if (position.balance == 0) return;
        uint256 amount = bound(rawAmount, 1, position.balance);
        if (renew) payments.setWithdrawal(id, amount);
        else payments.requestWithdrawal(id, amount);
    }

    function collect(uint8 rawChannel, uint96 total, bytes32 invoiceHash) external {
        uint256 id = 1 + rawChannel % 2;
        uint256 beforePaid = payments.viewPosition(address(this), id, address(this)).voucherPaid;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(VOUCHER_KEY, payments.voucherDigest(address(this), id, total, invoiceHash));
        uint256 amount = payments.collect(address(this), id, total, invoiceHash, abi.encodePacked(r, s, v));
        totalCollected += amount;
        assertEq(payments.viewPosition(address(this), id, address(this)).voucherPaid, beforePaid + amount);
    }

    function withdraw(uint8 rawChannel) external {
        uint256 id = rawChannel % 3;
        PayToPlay.PositionView memory position = payments.viewPosition(address(this), id, address(this));
        if (position.requestedAmount == 0 || block.timestamp < position.readyAt) return;
        totalWithdrawn += payments.withdraw(address(this), id);
        assertEq(payments.viewPosition(address(this), id, address(this)).requestedAmount, 0);
    }

    function move(uint8 rawSource, uint8 rawTarget) external {
        uint256 source = rawSource % 3;
        uint256 target = rawTarget % 3;
        if (source == target) return;
        PayToPlay.PositionView memory position = payments.viewPosition(address(this), source, address(this));
        if (position.requestedAmount == 0 || block.timestamp < position.readyAt) return;
        payments.move(source, target);
        successfulMoves++;
        assertEq(payments.viewPosition(address(this), source, address(this)).requestedAmount, 0);
    }

    function advanceTime(uint32 elapsed) external {
        vm.warp(block.timestamp + bound(elapsed, 0, 1000));
    }
}

contract PayToPlayInvariantTest is Test {
    PayToPlay private payments;
    PayToPlayHandler private handler;

    function setUp() public {
        payments = new PayToPlay(address(this), 100);
        payments.createChannel(makeAddr("pay-to-play invariant payee one"), 100);
        payments.createChannel(makeAddr("pay-to-play invariant payee two"), 100);
        handler = new PayToPlayHandler(payments);
        vm.deal(address(handler), 1_000_000 ether);
        handler.fund(1, 100);
        handler.request(1, 50, false);
        handler.advanceTime(100);
        handler.move(1, 0);
        handler.collect(0, 100, keccak256("invariant setup invoice"));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = PayToPlayHandler.fund.selector;
        selectors[1] = PayToPlayHandler.request.selector;
        selectors[2] = PayToPlayHandler.collect.selector;
        selectors[3] = PayToPlayHandler.withdraw.selector;
        selectors[4] = PayToPlayHandler.move.selector;
        selectors[5] = PayToPlayHandler.advanceTime.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantEveryFundedUnitIsStillHeldOrPaidExactlyOnce() external view {
        uint256 credited;
        uint256 paid;
        for (uint256 id = 0; id < 3; id++) {
            PayToPlay.PositionView memory position = payments.viewPosition(address(handler), id, address(handler));
            assertEq(position.voucherKey, id == 0 ? address(0) : handler.voucherKey());
            credited += position.balance;
            paid += position.voucherPaid;
            assertEq(
                position.effectiveBalance,
                position.balance > position.requestedAmount ? position.balance - position.requestedAmount : 0
            );
        }
        assertEq(credited, address(payments).balance);
        assertEq(paid, handler.totalCollected());
        assertEq(credited + handler.totalCollected() + handler.totalWithdrawn(), handler.totalFunded());
        assertGt(handler.totalCollected(), 0);
        assertGt(handler.successfulMoves(), 0);
    }
}
