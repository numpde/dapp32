// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/BasePaymaster.sol";
import "./BicycleComponentOpsFund.sol";

// Examples:
// https://github.com/opengsn/gsn/tree/master/packages/paymasters/contracts

contract BicycleComponentPaymaster is BasePaymaster {
    // Whitelist of contract/methods to be subsidized
    mapping(address => mapping(bytes4 => bool)) public methodWhitelist;

    bool public useRejectOnRecipientRevert = true;

    BicycleComponentOpsFund public opsFundContract;
    uint public opsToConsumePerCall = 1;

    event MethodWhitelisted(address indexed target, bytes4 indexed method, bool isAllowed);
    event TransactionSuccess(address indexed from, address indexed target, bytes4 indexed method);
    event TransactionFailure(address indexed from, address indexed target, bytes4 indexed method);

    function versionPaymaster() external view override virtual returns (string memory) {
        return "3.0.0-beta.3+opengsn.bcm.paymaster";
    }

    function opsFundContractAddress() public view returns (address) {
        return address(opsFundContract);
    }

    function setOpsFundContractAddress(address opsFundAddress) public onlyOwner {
        opsFundContract = BicycleComponentOpsFund(opsFundAddress);
    }

    function setRejectOnRecipientRevert(bool useReject) public onlyOwner {
        useRejectOnRecipientRevert = useReject;
    }

    function whitelistMethod(address target, bytes4 method, bool isAllowed) public onlyOwner {
        methodWhitelist[target][method] = isAllowed;
        emit MethodWhitelisted(target, method, isAllowed);
    }

    function getGasAndDataLimits()
    public override virtual view
    returns (
        IPaymaster.GasAndDataLimits memory limits
    ) {
        return super.getGasAndDataLimits();
    }

    function _preRelayedCall(
        GsnTypes.RelayRequest calldata relayRequest,
        bytes calldata signature,
        bytes calldata approvalData,
        uint256 maxPossibleGas
    )
    internal override virtual
    returns (bytes memory context, bool revertOnRecipientRevert) {
        (signature, maxPossibleGas);

        // Basic checks
        {
            require(approvalData.length == 0, "approvalData: invalid length");
            require(relayRequest.relayData.paymasterData.length == 0, "paymasterData: invalid length");
        }

        address target = relayRequest.request.to;
        bytes4 method = GsnUtils.getMethodSig(relayRequest.request.data);

        // Check if the method is whitelisted
        {
            require(methodWhitelist[target][method], "Method not whitelisted");
        }

        // Check / consume ops tokens of the sender
        {
            opsFundContract.consume(relayRequest.request.from, opsToConsumePerCall);
        }

        // useRejectOnRecipientRevert:
        // The flag that allows a Paymaster to "delegate" the rejection to the recipient code.
        // It also means the Paymaster trusts the recipient to reject fast b/c preRelayedCall,
        // forwarder check and recipient checks must fit into the GasLimits.acceptanceBudget,
        // otherwise the TX is paid by the Paymaster.
        // * `true` if the Paymaster wants to reject the TX if the recipient reverts.
        // * `false` if the Paymaster wants rejects by the recipient to be completed on chain and paid by the Paymaster.

        return (
            abi.encode(relayRequest.request.from, target, method),
            useRejectOnRecipientRevert
        );
    }

    function _postRelayedCall(
        bytes calldata context,
        bool success,
        uint256 gasUseWithoutPost,
        GsnTypes.RelayData calldata relayData
    )
    internal override virtual
    {
        (context, success, gasUseWithoutPost, relayData);

        (address requestFrom, address target, bytes4 method) = abi.decode(context, (address, address, bytes4));

        if (!success) {
            opsFundContract.refund(requestFrom, opsToConsumePerCall);

            emit TransactionFailure(requestFrom, target, method);
        } else {
            emit TransactionSuccess(requestFrom, target, method);
        }
    }
}
