pragma solidity 0.8.35;

import {PayToPlay} from "../../src/PayToPlay.sol";
import {PayToPlayTestBase} from "../support/PayToPlayTestBase.sol";

interface NativeAssetFunding {
    error FundingValueMismatch(uint256 declaredAmount, uint256 receivedValue);

    function asset() external view returns (address);
    function fund(uint256 channelId, uint256 amount) external payable;
}

contract PayToPlayNativeAssetTest is PayToPlayTestBase {
    address private constant NATIVE_ASSET = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event Funded(address indexed customer, uint256 indexed channelId, uint256 amount);

    function testAssetReturnsStableErc7528NativeSentinel() public {
        (bool firstSuccess, bytes memory firstResult) =
            address(payments).staticcall(abi.encodeWithSelector(NativeAssetFunding.asset.selector));
        assertTrue(firstSuccess, "asset() must be available");
        assertEq(abi.decode(firstResult, (address)), NATIVE_ASSET);

        _fund(customer, channel, 1);

        (bool secondSuccess, bytes memory secondResult) =
            address(payments).staticcall(abi.encodeWithSelector(NativeAssetFunding.asset.selector));
        assertTrue(secondSuccess, "asset() must remain available");
        assertEq(abi.decode(secondResult, (address)), NATIVE_ASSET);
        assertTrue(keccak256(firstResult) == keccak256(secondResult), "asset() identity must be stable");
    }

    function testFundCreditsExactDeclaredValueAndEmitsAmount() public {
        _fund(customer, channel, 1);
        uint256 amount = 25;
        vm.deal(customer, amount);
        vm.expectEmit(true, true, false, true, address(payments));
        emit Funded(customer, channel, amount);

        (bool success, bytes memory result) = _callFund(amount, amount);
        assertTrue(success, "matching native value must fund the declared amount");
        assertEq(result.length, 0, "successful funding returns no data");
        assertEq(_position(channel).balance, amount + 1);
        assertEq(payments.channel(channel).escrowTotal, amount + 1);
        assertEq(address(payments).balance, amount + 1);
        assertEq(customer.balance, 0);
    }

    function testFundingValueMismatchesRevertWithoutChangingPositionOrNativeBalances() public {
        _fund(customer, channel, 80);
        assertEq(
            payments.collect(customer, channel, 30, INVOICE_HASH, type(uint256).max, _sign(customer, channel, 30)), 30
        );
        vm.prank(customer);
        payments.requestWithdrawal(channel, 20);
        vm.deal(customer, 100);

        PayToPlay.PositionView memory positionBefore = _position(channel);
        PayToPlay.Channel memory channelBefore = payments.channel(channel);
        uint256 customerBalanceBefore = customer.balance;
        uint256 contractBalanceBefore = address(payments).balance;

        uint256[4] memory amounts = [uint256(10), 10, 0, 1];
        uint256[4] memory values = [uint256(9), 11, 1, 0];
        for (uint256 i; i < amounts.length; ++i) {
            (bool success, bytes memory result) = _callFund(values[i], amounts[i]);
            assertFalse(success, "mismatched funding value must revert");
            assertEq(
                keccak256(result),
                keccak256(
                    abi.encodeWithSelector(NativeAssetFunding.FundingValueMismatch.selector, amounts[i], values[i])
                ),
                "mismatch must use the funding boundary's error"
            );
            assertEq(keccak256(abi.encode(_position(channel))), keccak256(abi.encode(positionBefore)));
            assertEq(keccak256(abi.encode(payments.channel(channel))), keccak256(abi.encode(channelBefore)));
            assertEq(customer.balance, customerBalanceBefore);
            assertEq(address(payments).balance, contractBalanceBefore);
        }
    }

    function testLegacyFundSelectorIsUnavailable() public {
        vm.deal(customer, 3);
        vm.prank(customer);
        (bool success,) = address(payments).call{value: 3}(abi.encodeWithSignature("fund(uint256)", channel));
        assertFalse(success, "legacy implicit-value funding must not remain callable");
        assertEq(_position(channel).balance, 0);
        assertEq(payments.channel(channel).escrowTotal, 0);
        assertEq(customer.balance, 3);
        assertEq(address(payments).balance, 0);
    }

    function testZeroFundingIsACompleteNoOp() public {
        _fund(customer, channel, 80);
        assertEq(
            payments.collect(customer, channel, 30, INVOICE_HASH, type(uint256).max, _sign(customer, channel, 30)), 30
        );
        vm.prank(customer);
        payments.requestWithdrawal(channel, 20);
        PayToPlay.PositionView memory positionBefore = _position(channel);
        PayToPlay.Channel memory channelBefore = payments.channel(channel);
        uint256 customerBalanceBefore = customer.balance;
        uint256 contractBalanceBefore = address(payments).balance;

        vm.recordLogs();
        (bool success, bytes memory result) = _callFund(0, 0);
        assertTrue(success, "zero funding with zero value remains valid");
        assertEq(result.length, 0, "successful zero funding returns no data");
        assertEq(vm.getRecordedLogs().length, 0, "zero funding emits no events");
        assertEq(keccak256(abi.encode(_position(channel))), keccak256(abi.encode(positionBefore)));
        assertEq(keccak256(abi.encode(payments.channel(channel))), keccak256(abi.encode(channelBefore)));
        assertEq(customer.balance, customerBalanceBefore);
        assertEq(address(payments).balance, contractBalanceBefore);
    }

    function testFuzzMatchingNativeValueCreditsExactlyDeclaredAmount(uint96 amount) public {
        vm.deal(customer, amount);
        (bool success, bytes memory result) = _callFund(amount, amount);
        assertTrue(success, "matching native value must fund the declared amount");
        assertEq(result.length, 0, "successful funding returns no data");
        assertEq(_position(channel).balance, amount);
        assertEq(payments.channel(channel).escrowTotal, amount);
        assertEq(address(payments).balance, amount);
        assertEq(customer.balance, 0);
        if (amount == 0) {
            assertEq(_position(channel).scheduledRefundAt, 0);
        } else {
            assertGt(_position(channel).scheduledRefundAt, 0);
        }
    }

    function _callFund(uint256 value, uint256 amount) private returns (bool, bytes memory) {
        vm.prank(customer);
        return
            address(payments).call{value: value}(
                abi.encodeWithSelector(NativeAssetFunding.fund.selector, channel, amount)
            );
    }
}
