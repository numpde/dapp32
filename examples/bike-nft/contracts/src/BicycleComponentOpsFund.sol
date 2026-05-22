// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./BicycleComponentManager.sol";

/**
 * @title Bicycle Component Operations Fund
 * @dev This contract manages "operations allowances" for actions such as renaming and transferring
 * bicycle component Non-Fungible Tokens (NFTs). It leverages OpenZeppelin's AccessControl
 * for role-based access control, allowing distinct entities to perform specific operations.
 *
 * The contract defines three roles:
 * 1) Paymaster - Authorized to consume or reduce the allowance of an address for operations.
 * 2) Ops Manager - Empowered to increment the allowance of an address.
 * 3) Carte Blanche - Any address with this role enjoys unlimited allowance, which never depletes.
 *
 * The contract also allows for setting a default allowance increment value. This value
 * is typically added to the allowance when an address is granted a new component NFT,
 * thereby replenishing the operations allowance.
 */
contract BicycleComponentOpsFund is AccessControl {
    bytes32 public constant PAYMASTER_ROLE = keccak256("PAYMASTER_ROLE");
    bytes32 public constant OPS_MANAGER_ROLE = keccak256("OPS_MANAGER_ROLE");
    bytes32 public constant CARTE_BLANCHE_ROLE = keccak256("CARTE_BLANCHE_ROLE");

    uint public defaultAllowanceIncrement = 3;

    mapping(address => uint) private _allowanceOf;

    event DefaultAllowanceIncrementSet(uint newInitialOpsAllowance);
    event AllowanceAdded(address indexed owner, uint amount);
    event AllowanceConsumed(address indexed owner, uint amount);
    event AllowanceRefunded(address indexed owner, uint amount);

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAYMASTER_ROLE, msg.sender);
        _setupRole(OPS_MANAGER_ROLE, msg.sender);
        _setupRole(CARTE_BLANCHE_ROLE, msg.sender);
    }

    function allowanceOf(address owner) public view returns (uint) {
        return hasRole(CARTE_BLANCHE_ROLE, owner) ? type(uint).max : _allowanceOf[owner];
    }

    function setDefaultAllowanceIncrement(uint newDefaultAllowanceIncrement) public onlyRole(DEFAULT_ADMIN_ROLE) {
        defaultAllowanceIncrement = newDefaultAllowanceIncrement;
        emit DefaultAllowanceIncrementSet(newDefaultAllowanceIncrement);
    }

    function addAllowance(address owner, uint amount) public onlyRole(OPS_MANAGER_ROLE) {
        if (!hasRole(CARTE_BLANCHE_ROLE, owner)) {
            _allowanceOf[owner] += amount;
        }

        emit AllowanceAdded(owner, amount);
    }

    function consume(address owner, uint amount) public onlyRole(PAYMASTER_ROLE) {
        if (!hasRole(CARTE_BLANCHE_ROLE, owner)) {
            require(_allowanceOf[owner] >= amount, "Insufficient ops allowance");
            _allowanceOf[owner] -= amount;
        }

        emit AllowanceConsumed(owner, amount);
    }

    function refund(address owner, uint amount) public onlyRole(PAYMASTER_ROLE) {
        if (!hasRole(CARTE_BLANCHE_ROLE, owner)) {
            _allowanceOf[owner] += amount;
        }

        emit AllowanceRefunded(owner, amount);
    }
}
