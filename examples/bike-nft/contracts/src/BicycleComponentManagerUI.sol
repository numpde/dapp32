// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "@opengsn/contracts/src/ERC2771Recipient.sol";

import "./BicycleComponentManager.sol";
import "./BaseUI.sol";
import "./Utils.sol";


contract BicycleComponentManagerUI is BaseUI {
    using Utils for string;

    string public constant INSUFFICIENT_RIGHTS = "BicycleComponentManagerUI: Insufficient rights";

    BicycleComponentManager public bicycleComponentManager;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address payable bcmAddress, address myTrustedForwarder, string memory myBaseURI) public initializer {
        __BaseUI_init(myTrustedForwarder, myBaseURI);
        bicycleComponentManager = BicycleComponentManager(bcmAddress);
    }

    // Helpers

    function _getOpsBalance(address who) internal view returns (uint256) {
        BicycleComponentOpsFund opsFundContract = bicycleComponentManager.opsFundContract();

        try opsFundContract.allowanceOf(who) returns (uint256 allowance) {
            return allowance;
        } catch {
            return 0;
        }
    }

    // "Write" functions

    function updateAddressInfo(
        address infoAddress,
        string memory addressInfo
    )
    public
    {
        bicycleComponentManager.setAccountInfoByUI(infoAddress, addressInfo, _msgSender());
    }

    function register(
        address registerFor,
        string memory registerSerialNumber,
        string memory registerName,
        string memory registerDescription,
        string memory registerImageURL
    )
    public
    {
        string[] memory emptyArray;
        string memory uri = string("").stringifyOnChainMetadata(registerName, registerDescription, registerImageURL, emptyArray, emptyArray).packJSON();

        bicycleComponentManager.registerByUI(registerFor, registerSerialNumber, uri, _msgSender());
    }

    function transfer(
        string memory registerSerialNumber,
        address transferToAddress
    )
    public
    {
        require(
            bicycleComponentManager.ownerOf(registerSerialNumber) != transferToAddress,
            "Let's not waste gas"
        );

        bicycleComponentManager.transferByUI(registerSerialNumber, transferToAddress, _msgSender());
    }

    function updateNFT(
        string memory registerSerialNumber,
        string memory registerName,
        string memory registerDescription,
        string memory registerImageURL
    )
    public
    {
        string[] memory emptyArray;
        string memory uri = string("").stringifyOnChainMetadata(registerName, registerDescription, registerImageURL, emptyArray, emptyArray).packJSON();

        bicycleComponentManager.setComponentURIByUI(registerSerialNumber, uri, _msgSender());
    }

    // Views

    function viewEntry(address userAddress)
    external view
    returns (string memory, string memory userAddressInfo)
    {
        if (bicycleComponentManager.canRegister(userAddress)) {
            return (_composeWithBaseURI("viewEntry.isRegistrar.returns.json"), bicycleComponentManager.accountInfo(userAddress));
        } else {
            return (_composeWithBaseURI("viewEntry.noRegistrar.returns.json"), bicycleComponentManager.accountInfo(userAddress));
        }
    }

    function viewIsNewSerialNumber(string memory registerSerialNumber)
    external view
    returns (string memory, address ownerAddress, string memory ownerInfo, address nftContractAddress, uint256 nftTokenId)
    {
        ownerAddress = bicycleComponentManager.ownerOf(registerSerialNumber);

        if (ownerAddress != address(0)) {
            ownerInfo = bicycleComponentManager.accountInfo(ownerAddress); // possibly the empty string

            nftContractAddress = address(bicycleComponentManager.nftContract());
            nftTokenId = bicycleComponentManager.generateTokenId(registerSerialNumber);

            return (_composeWithBaseURI("viewIsNewSerialNumber.hasSerialNumber.returns.json"), ownerAddress, ownerInfo, nftContractAddress, nftTokenId);
        } else {
            return (_composeWithBaseURI("viewIsNewSerialNumber.newSerialNumber.returns.json"), address(0), "", address(0), 0);
        }
    }

    function viewRegisterForm(address userAddress)
    external view
    returns (string memory)
    {
        if (bicycleComponentManager.canRegister(userAddress)) {
            return _composeWithBaseURI("viewRegisterForm.isRegistrar.returns.json");
        } else {
            return _composeWithBaseURI("viewRegisterForm.noRegistrar.returns.json");
        }
    }

    function viewRegisterQR() external view returns (string memory)
    {
        return _composeWithBaseURI("viewRegisterQR.returns.json");
    }

    function viewRegisterOnFailure() public view returns (string memory) {
        return _composeWithBaseURI("viewRegisterOnFailure.returns.json");
    }

    function viewRegisterOnSuccess() public view returns (string memory) {
        return _composeWithBaseURI("viewRegisterOnSuccess.returns.json");
    }

    function viewTransfer(address userAddress, string memory registerSerialNumber)
    external view
    returns (string memory, address transferFromAddress, uint256 userOpsBalance)
    {
        transferFromAddress = bicycleComponentManager.ownerOf(registerSerialNumber);

        if (transferFromAddress != address(0)) {
            return (_composeWithBaseURI("viewTransfer.hasSerialNumber.returns.json"), transferFromAddress, _getOpsBalance(userAddress));
        } else {
            return (_composeWithBaseURI("viewTransfer.newSerialNumber.returns.json"), transferFromAddress, _getOpsBalance(userAddress));
        }
    }

    // userAddress: connected address as provided by the front-end
    function viewUpdateUserAddressInfo(address userAddress)
    public view
    returns (string memory, address infoAddress, string memory addressInfo, uint256 userOpsBalance)
    {
        return (
            _composeWithBaseURI("viewUpdateAddressInfo.returns.json"),
            userAddress,
            bicycleComponentManager.accountInfo(userAddress),
            _getOpsBalance(userAddress)
        );
    }

    // ownerAddress: address of the owner of the serial number
    function viewUpdateOwnerAddressInfo(address userAddress, address ownerAddress)
    public view
    returns (string memory, address infoAddress, string memory addressInfo, uint256 userOpsBalance)
    {
        return (
            _composeWithBaseURI("viewUpdateAddressInfo.returns.json"),
            ownerAddress,
            bicycleComponentManager.accountInfo(ownerAddress),
            _getOpsBalance(userAddress)
        );
    }

    function viewUpdateAddressInfoOnFailure() public view returns (string memory) {
        return _composeWithBaseURI("viewUpdateAddressInfoOnFailure.returns.json");
    }

    function viewUpdateAddressInfoOnSuccess(address infoAddress) public view returns (string memory, string memory addressInfo) {
        return (
            _composeWithBaseURI("viewUpdateAddressInfoOnSuccess.returns.json"),
            bicycleComponentManager.accountInfo(infoAddress)
        );
    }

    function viewUpdateNFT(address userAddress, string memory registerSerialNumber)
    public view
    returns (
        string memory,
        address registerFor,
        address nftContractAddress, uint256 nftTokenId,
        string memory registerName, string memory registerDescription, string memory registerImageURL,
        uint256 userOpsBalance
    )
    {
        registerFor = bicycleComponentManager.ownerOf(registerSerialNumber);
        nftContractAddress = address(bicycleComponentManager.nftContract());
        nftTokenId = bicycleComponentManager.generateTokenId(registerSerialNumber);

        return (
            _composeWithBaseURI("viewUpdateNFT.returns.json"),
            registerFor,
            nftContractAddress, nftTokenId,
            "", "", "",
            _getOpsBalance(userAddress)
        );
    }
}
