// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155BurnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import "./BicycleComponentManager.sol";


abstract contract BlanksBase is Initializable, ERC1155Upgradeable, AccessControlUpgradeable, PausableUpgradeable, ERC1155BurnableUpgradeable, ERC1155SupplyUpgradeable, UUPSUpgradeable {
    bytes32 public constant URI_SETTER_ROLE = keccak256("URI_SETTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() initializer public virtual {
        __ERC1155_init("");
        __AccessControl_init();
        __Pausable_init();
        __ERC1155Burnable_init();
        __ERC1155Supply_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        _grantRole(URI_SETTER_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(MINTER_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
    }

    function setURI(string memory newuri) public onlyRole(URI_SETTER_ROLE) {
        _setURI(newuri);
    }

    function pause() public onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() public onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function mint(address account, uint256 id, uint256 amount, bytes memory data)
    public
    onlyRole(MINTER_ROLE)
    {
        _mint(account, id, amount, data);
    }

    function _authorizeUpgrade(address newImplementation)
    internal
    onlyRole(UPGRADER_ROLE)
    override
    {}

    // The following functions are overrides required by Solidity.

    function _beforeTokenTransfer(address operator, address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
    internal virtual
    whenNotPaused
    override(ERC1155Upgradeable, ERC1155SupplyUpgradeable)
    {
        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }

    function supportsInterface(bytes4 interfaceId)
    public
    view
    override(ERC1155Upgradeable, AccessControlUpgradeable)
    returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}


contract BlanksOpenSea is BlanksBase {
    using Utils for string;

    bytes32 public constant PROXY_ROLE = keccak256("PROXY_ROLE");

    address public owner;
    string public contractURI;

    address public bicycleComponentManager;

    mapping(uint256 => string) public customTokenURI;

    // 0x0000000000000000000000000000000AFADEDFACEFACADE0FADEAFBA0BABB0B0

    uint256 public constant BLANK_NFT_TOKEN_ID_A = 1;
    uint256 public constant BLANK_NFT_TOKEN_ID_B = 2;
    uint256 public constant BLANK_NFT_TOKEN_ID_C = 3;
    uint256 public constant BLANK_NFT_TOKEN_ID_D = 4;

    event Registered(address indexed blankTokenOwner, address indexed registerFor, string indexed serialNumber, string tokenURI);
    event BalanceWithdrawn(address indexed);

    function initialize() initializer public override {
        BlanksBase.initialize();
        owner = msg.sender;

        // _mint(msg.sender, BLANK_NFT_TOKEN_ID_B, 10, "");
    }

    // https://support.opensea.io/hc/en-us/articles/4403934341907-How-do-I-import-my-contract-automatically-
    function claimOwnership() public onlyRole(DEFAULT_ADMIN_ROLE) {
        owner = msg.sender;
    }

    // https://docs.opensea.io/docs/contract-level-metadata
    function setContractURI(string memory newURI) public onlyRole(DEFAULT_ADMIN_ROLE) {
        contractURI = newURI;
    }

    function setBicycleComponentManager(address bcmAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        bicycleComponentManager = bcmAddress;
    }

    // Token URI: use the default, unless the token has a custom URI

    function setCustomTokenURI(uint256 tokenId, string memory newURI) public onlyRole(URI_SETTER_ROLE) {
        customTokenURI[tokenId] = newURI;
    }

    function uri(uint256 id) public view override returns (string memory) {
        if (bytes(customTokenURI[id]).length > 0) {
            return customTokenURI[id];
        }

        return super.uri(id);
    }

    // Prevent transfers of privileged tokens, except by an admin

    function isPrivilegedToken(uint256 id) public pure returns (bool) {
        return (id == BLANK_NFT_TOKEN_ID_A) || (id == BLANK_NFT_TOKEN_ID_B) || (id == BLANK_NFT_TOKEN_ID_C);
    }

    function _beforeTokenTransfer(address operator, address from, address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
    internal virtual override
    {
        if (
        // An admin can transfer any token
            hasRole(DEFAULT_ADMIN_ROLE, operator) ||
            // Any approved operator can burn any token
            (to == address(0)) ||
            // An approved operator can transfer any token from a minter
            hasRole(MINTER_ROLE, from)
        ) {
            //
            // This is ok
            //
        } else {
            // Otherwise we check for privileged token transfer
            for (uint256 i = 0; i < ids.length; ++i) {
                require(!isPrivilegedToken(ids[i]), "BlanksOpenSea: Transfer of privileged token");
            }
        }

        super._beforeTokenTransfer(operator, from, to, ids, amounts, data);
    }

    function isApprovedForAll(address _owner, address operator) public view override returns (bool) {
        if (hasRole(DEFAULT_ADMIN_ROLE, operator)) {
            return true;
        }

        return super.isApprovedForAll(_owner, operator);
    }

    function _tokenAuthority(uint256 tokenId) internal pure returns (string memory) {
        if (tokenId == BLANK_NFT_TOKEN_ID_A) {
            return "A";
        } else if (tokenId == BLANK_NFT_TOKEN_ID_B) {
            return "B";
        } else if (tokenId == BLANK_NFT_TOKEN_ID_C) {
            return "C";
        } else if (tokenId == BLANK_NFT_TOKEN_ID_D) {
            return "D";
        } else {
            return "N/A";
        }
    }

    // Conversion of a Blank to an NFT via the BicycleComponentManager

    function _refund(uint256 got, uint256 expected, address to) internal {
        if (got > expected) {
            uint256 refundAmount = got - expected;

            bool refundSuccess = payable(to).send(refundAmount);
            // Alternative:
            // (bool refundSuccess, ) = payable(msg.sender).call{value: refundAmount}("");

            require(refundSuccess, "BlanksOpenSea: Failed to refund");
        }
    }

    // @notice Attempt to register a bicycle serial number with the BicycleComponentManager for `msg.sender`.
    // @dev This function is non-payable because the idea is to convert an existing Blank to an NFT.
    function register(uint256 tokenId, string memory serialNumber, string memory name, string memory description, string memory imageURL)
    external
    {
        // Note: we don't use _msgSender() here because we're not checking
        // for a trusted forwarder in case we're in a meta-transaction.
        address tokenOwner = msg.sender;

        _register(tokenOwner, tokenOwner, tokenId, serialNumber, name, description, imageURL);
    }

    // @notice For registration by another contract (proxy), such as an UI contract.
    // @dev Revers if `msg.sender` is not an approved proxy.
    // @dev This function is non-payable because the idea is to convert an existing Blank to an NFT.
    function proxiedRegister(
        address blankTokenOwner,
        address registerFor,
        uint256 blankTokenId,
        string memory registerSerialNumber,
        string memory registerName,
        string memory registerDescription,
        string memory registerImageURL
    )
    external
    {
        require(
        // We don't use `onlyRole` because it uses to `_msgSender()`.
        // This function should be called by an approved proxy directly.
            hasRole(PROXY_ROLE, msg.sender),
            "BlanksOpenSea: msg.sender is not an approved proxy"
        );

        _register(blankTokenOwner, registerFor, blankTokenId, registerSerialNumber, registerName, registerDescription, registerImageURL);
    }

    // @notice Register a bicycle serial number with the BicycleComponentManager.
    // The tokenOwner must be the owner of the Blank NFT (tokenId).
    function _register(
        address blankTokenOwner,
        address registerFor,
        uint256 tokenId,
        string memory serialNumber,
        string memory name,
        string memory description,
        string memory imageURL
    )
    internal
    {
        require(bicycleComponentManager != address(0), "BlanksOpenSea: BicycleComponentManager not set");

        uint256 balance = balanceOf(blankTokenOwner, tokenId);
        require(balance > 0, "BlanksOpenSea: blankTokenOwner has no such token");

        string[] memory attrT = new string[](1);
        string[] memory attrV = new string[](1);

        attrT[0] = "Authority";
        attrV[0] = _tokenAuthority(tokenId);

        string memory tokenURI = string("").stringifyOnChainMetadata(name, description, imageURL, attrT, attrV).packJSON();

        BicycleComponentManager bcm = BicycleComponentManager(bicycleComponentManager);

        // We don't send any `value`, since the idea is to convert an existing Blank to an NFT.
        bcm.register{value: 0}(registerFor, serialNumber, tokenURI);

        // BicycleComponentManager should mint a token for the owner in its
        // managed BicycleComponent NFT contract, so we burn the token here
        _burn(blankTokenOwner, tokenId, 1);

        emit Registered(blankTokenOwner, registerFor, serialNumber, tokenURI);

        bcm.generateTokenId(serialNumber);
    }

    // Fallback & withdraw

    receive() external payable {
    }

    function withdraw() public onlyRole(DEFAULT_ADMIN_ROLE) {
        // Use `_msgSender` because that's what `onlyRole` uses internally
        payable(_msgSender()).transfer(address(this).balance);
        emit BalanceWithdrawn(_msgSender());
    }
}
