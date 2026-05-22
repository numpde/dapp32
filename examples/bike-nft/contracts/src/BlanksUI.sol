// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "./BlanksOpenSea.sol";
import "./BicycleComponentManager.sol";
import "./BaseUI.sol";


contract BlanksUI is BaseUI {
    address payable public blanksContractAddress;

    mapping(address => uint256[]) public registeredNftTokens;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address payable myBlanksContract, address myTrustedForwarder, string memory myBaseURI) public initializer
    {
        __BaseUI_init(myTrustedForwarder, myBaseURI);
        setBlanksContractAddress(myBlanksContract);
    }

    // @notice Set the "Blanks" contract to be managed
    function setBlanksContractAddress(address payable newAddress) public onlyRole(DEFAULT_ADMIN_ROLE) {
        blanksContractAddress = newAddress;
    }

    function _getTokenCount(address userAddress, uint256 blankTokenId)
    internal view
    returns (uint256) {
        BlanksOpenSea blanksContract = BlanksOpenSea(blanksContractAddress);
        return blanksContract.balanceOf(userAddress, blankTokenId);
    }

    function viewEntry(address userAddress)
    public view
    returns (string memory, uint256 tokenCountA, uint256 tokenCountB, uint256 tokenCountC, uint256 tokenCountD) {
        BlanksOpenSea blanksContract = BlanksOpenSea(blanksContractAddress);

        tokenCountA = blanksContract.balanceOf(userAddress, blanksContract.BLANK_NFT_TOKEN_ID_A());
        tokenCountB = blanksContract.balanceOf(userAddress, blanksContract.BLANK_NFT_TOKEN_ID_B());
        tokenCountC = blanksContract.balanceOf(userAddress, blanksContract.BLANK_NFT_TOKEN_ID_C());
        tokenCountD = blanksContract.balanceOf(userAddress, blanksContract.BLANK_NFT_TOKEN_ID_D());

        return (
            _composeWithBaseURI("viewEntry.returns.json"),
            tokenCountA, tokenCountB, tokenCountC, tokenCountD
        );
    }

    function viewEntryA(address userAddress) public view returns (string memory, uint256 blankTokenId, uint256 blankTokenCount) {
        return _viewRegisterForm(userAddress, BlanksOpenSea(blanksContractAddress).BLANK_NFT_TOKEN_ID_A());
    }

    function viewEntryB(address userAddress) public view returns (string memory, uint256 blankTokenId, uint256 blankTokenCount) {
        return _viewRegisterForm(userAddress, BlanksOpenSea(blanksContractAddress).BLANK_NFT_TOKEN_ID_B());
    }

    function viewEntryC(address userAddress) public view returns (string memory, uint256 blankTokenId, uint256 blankTokenCount) {
        return _viewRegisterForm(userAddress, BlanksOpenSea(blanksContractAddress).BLANK_NFT_TOKEN_ID_C());
    }

    function viewEntryD(address userAddress) public view returns (string memory, uint256 blankTokenId, uint256 blankTokenCount) {
        return _viewRegisterForm(userAddress, BlanksOpenSea(blanksContractAddress).BLANK_NFT_TOKEN_ID_D());
    }

    function _viewRegisterForm(address userAddress, uint256 blankTokenId)
    internal view
    returns (string memory ui, uint256, uint256 blankTokenCount)
    {
        (ui, blankTokenCount) = viewRegisterForm(userAddress, blankTokenId);
        return (ui, blankTokenId, blankTokenCount);
    }

    function viewRegisterForm(address userAddress, uint256 blankTokenId)
    public view
    returns (string memory, uint256 blankTokenCount)
    {
        blankTokenCount = _getTokenCount(userAddress, blankTokenId);

        if (blankTokenCount == 0) {
            return (_composeWithBaseURI("viewRegisterForm.noToken.returns.json"), blankTokenCount);
        } else {
            return (_composeWithBaseURI("viewRegisterForm.hasTokens.returns.json"), blankTokenCount);
        }
    }

    function viewPreregisterCheck(address userAddress, string memory registerSerialNumber)
    public view
    returns (string memory, uint256 nftTokenId)
    {
        (userAddress, registerSerialNumber); // silence warnings

        BlanksOpenSea blanksContract = BlanksOpenSea(blanksContractAddress);
        BicycleComponentManager bcm = BicycleComponentManager(blanksContract.bicycleComponentManager());

        nftTokenId = bcm.generateTokenId(registerSerialNumber);

        try bcm.ownerOf(registerSerialNumber) returns (address) {
            return (_composeWithBaseURI("viewPreregisterCheck.alreadyRegistered.returns.json"), nftTokenId);
        } catch {
            return (_composeWithBaseURI("viewPreregisterCheck.notYetRegistered.returns.json"), nftTokenId);
        }
    }

    // @notice
    function register(
        address userAddress, // connected address as provided by the front-end
        address registerFor,
        uint256 blankTokenId,
        string memory registerSerialNumber,
        string memory registerName,
        string memory registerDescription,
        string memory registerImageURL
    )
    public
    {
        require(
        // Note: `_msgSender()` checks whether `msg.sender` is a trusted forwarder.
            userAddress == _msgSender(),
            "BlanksUI: userAddress and _msgSender don't match (or not a trusted forwarder)"
        );

        // Having verified `userAddress`, we assume that's who is converting their own Blank.
        // The `BlanksOpenSea` contract will check that they indeed have the Blank tokens.
        address blankTokenOwner = userAddress;

        BlanksOpenSea blanksContract = BlanksOpenSea(blanksContractAddress);
        blanksContract.proxiedRegister(blankTokenOwner, registerFor, blankTokenId, registerSerialNumber, registerName, registerDescription, registerImageURL);

        uint256 nftTokenId = BicycleComponentManager(blanksContract.bicycleComponentManager()).generateTokenId(registerSerialNumber);
        registeredNftTokens[userAddress].push(nftTokenId);
    }

    function viewRegisterOnFailure(address userAddress) public view returns (string memory) {
        userAddress; // silence warnings
        return _composeWithBaseURI("viewRegisterOnFailure.returns.json");
    }

    function viewRegisterOnSuccess(address userAddress) public view returns (string memory, uint256[] memory nftTokens) {
        return (
            _composeWithBaseURI("viewRegisterOnSuccess.returns.json"),
            registeredNftTokens[userAddress]
        );
    }
}
