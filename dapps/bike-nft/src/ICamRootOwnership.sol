pragma solidity 0.8.35;

/// @notice CAM host authority used by the Bike deployment handover screen.
interface ICamRootOwnership {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function acceptOwnership() external;
    function contractAddress(string calldata name) external view returns (address);
}
