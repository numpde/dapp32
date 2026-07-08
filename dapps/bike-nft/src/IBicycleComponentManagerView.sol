pragma solidity 0.8.35;

import {IERC165} from "@openzeppelin-contracts-5.6.1/utils/introspection/IERC165.sol";

/// @notice Read-only manager surface consumed by CAM route projections.
/// @dev This interface is the shared source of truth for UI-facing manager
/// views. It deliberately excludes write/admin functions.
interface IBicycleComponentManagerView is IERC165 {
    enum ComponentStatus {
        None,
        Active,
        Missing,
        Retired
    }

    struct ComponentView {
        bool exists;
        bytes32 serialHash;
        address tokenContract;
        uint256 tokenId;
        address owner;
        address registrar;
        ComponentStatus status;
        string tokenURI;
        string missingReportURI;
        uint48 registeredAt;
        uint48 updatedAt;
        string serialNumber;
    }

    function componentsAddress() external view returns (address);

    function accountInfo(address account) external view returns (string memory);

    function canRegister(address actor) external view returns (bool);

    function componentBySerial(string calldata serialNumber) external view returns (ComponentView memory view_);

    function permissionsOf(address actor, string calldata serialNumber) external view returns (uint64 capabilities);

    function canUpdateMetadata(address actor, string calldata serialNumber) external view returns (bool);

    function canMarkMissing(address actor, string calldata serialNumber) external view returns (bool);

    function canClearMissing(address actor, string calldata serialNumber) external view returns (bool);

    function canRetire(address actor, string calldata serialNumber) external view returns (bool);
}
