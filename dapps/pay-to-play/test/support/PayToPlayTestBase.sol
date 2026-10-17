pragma solidity 0.8.35;

import {Test} from "forge-std-1.12.0/src/Test.sol";

import {PayToPlay} from "../../src/PayToPlay.sol";

abstract contract PayToPlayTestBase is Test {
    uint256 internal constant CUSTOMER_KEY = uint256(keccak256("pay-to-play local test customer"));
    uint256 internal constant VOUCHER_KEY = uint256(keccak256("pay-to-play local test voucher key"));
    uint64 internal constant PERIOD = 100;
    PayToPlay internal payments;
    address internal customer;
    address internal payee;
    address internal relayer;
    uint256 internal channel;
    uint256 internal otherChannel;

    function setUp() public virtual {
        customer = vm.addr(CUSTOMER_KEY);
        payee = makeAddr("pay-to-play fixture payee");
        relayer = makeAddr("pay-to-play fixture relayer");
        payments = new PayToPlay(address(this), PERIOD);
        channel = payments.createChannel(payee, PERIOD);
        otherChannel = payments.createChannel(makeAddr("pay-to-play fixture second payee"), PERIOD);
        vm.startPrank(customer);
        payments.registerVoucherKey(channel, vm.addr(VOUCHER_KEY));
        payments.registerVoucherKey(otherChannel, vm.addr(VOUCHER_KEY));
        vm.stopPrank();
    }

    function _fund(address account, uint256 id, uint256 amount) internal {
        vm.deal(account, account.balance + amount);
        vm.prank(account);
        payments.fund{value: amount}(id);
    }

    function _sign(address account, uint256 id, uint256 total) internal returns (bytes memory) {
        bytes32 digest = payments.voucherDigest(account, id, total);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VOUCHER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _position(uint256 id) internal view returns (PayToPlay.PositionView memory) {
        return payments.viewPosition(customer, id, customer);
    }

    function _hasAction(string[] memory actions, string memory action) internal pure returns (bool) {
        for (uint256 i = 0; i < actions.length; i++) {
            if (keccak256(bytes(actions[i])) == keccak256(bytes(action))) return true;
        }
        return false;
    }
}
