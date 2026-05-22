// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/ERC2771Recipient.sol";

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";


abstract contract BaseUI is ERC2771Recipient, Initializable, PausableUpgradeable, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    string public baseURI;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __BaseUI_init(address myTrustedForwarder, string memory myBaseURI) initializer public {
        __Pausable_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
        _grantRole(REGISTRAR_ROLE, msg.sender);

        setTrustedForwarder(myTrustedForwarder);
        setBaseURI(myBaseURI);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation)
    internal
    onlyRole(UPGRADER_ROLE)
    override
    {
        // The upgrade is authorized!
    }

    function setTrustedForwarder(address newAddress) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTrustedForwarder(newAddress);
    }

    function setBaseURI(string memory newBaseURI) public virtual onlyRole(DEFAULT_ADMIN_ROLE) {
        baseURI = newBaseURI;
    }

    function abiURI() public virtual view returns (string memory) {
        return _composeWithBaseURI("abi.json");
    }

    function _composeWithBaseURI(string memory path) internal view returns (string memory) {
        return string(abi.encodePacked(baseURI, path));
    }

    // Defaults

    receive() external payable {
        revert("Does not accept payments.");
    }

    fallback() external payable {
        revert("Contract function not found.");
    }

    // Overrides resolution

    function _msgSender()
    internal virtual view override(ERC2771Recipient, ContextUpgradeable)
    returns (address)
    {
        return ERC2771Recipient._msgSender();
    }

    function _msgData()
    internal virtual view override(ERC2771Recipient, ContextUpgradeable)
    returns (bytes calldata ret)
    {
        return ERC2771Recipient._msgData();
    }
}
