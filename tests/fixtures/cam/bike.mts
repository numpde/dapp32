export const BIKE_HOST_CHAIN_ID = "eip155:31337"
export const BIKE_HOST_ADDRESS = "0x0000000000000000000000000000000000000001"
export const BIKE_ACCOUNT_ADDRESS = "0x0000000000000000000000000000000000000002"
export const BIKE_UI_ADDRESS = "0x0000000000000000000000000000000000000003"
export const BIKE_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000004"
export const BIKE_COMPONENTS_ADDRESS = "0x0000000000000000000000000000000000000010"

export const BIKE_UI_CONTRACT = "BicycleComponentManagerUI"
export const BIKE_MANAGER_CONTRACT = "BicycleComponentManager"
export const BIKE_UI_NAMESPACE = `contracts.${BIKE_UI_CONTRACT}`
export const BIKE_MANAGER_NAMESPACE = `contracts.${BIKE_MANAGER_CONTRACT}`
export const BIKE_ROUTES_NAMESPACE = "routes"
export const BIKE_UI_RESOURCE_NAMESPACE = "ui"

export const BIKE_ROUTE_ENTRY = "entry"
export const BIKE_ROUTE_COMPONENT = "component"
export const BIKE_ROUTE_REGISTER = "register"

export const BIKE_VIEW_ENTRY = "viewEntry"
export const BIKE_VIEW_COMPONENT = "viewComponent"
export const BIKE_VIEW_REGISTER = "viewRegister"
export const BIKE_MARK_MISSING = "markMissing"

export const BIKE_CAM_URI = "ipfs://example/main.json"

export const BIKE_RELATIVE_UI_ABI_URI = "./abi/BicycleComponentManagerUI.json"
export const BIKE_RELATIVE_MANAGER_ABI_URI = "./abi/BicycleComponentManager.json"
export const BIKE_RELATIVE_UI_URI = "./ui.json"
export const BIKE_UI_ABI_URI = bikeResourceURI(BIKE_RELATIVE_UI_ABI_URI)
export const BIKE_MANAGER_ABI_URI = bikeResourceURI(BIKE_RELATIVE_MANAGER_ABI_URI)
export const BIKE_UI_URI = bikeResourceURI(BIKE_RELATIVE_UI_URI)

export const BIKE_SERIAL_NUMBER = "ABC123"
export const BIKE_ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
export const BIKE_UNSIGNED_CAM_HASH = BIKE_ZERO_BYTES32

export const bikeHost = {
  chainId: BIKE_HOST_CHAIN_ID,
  address: BIKE_HOST_ADDRESS,
} as const

export const bikeContractAddresses = {
  [BIKE_UI_CONTRACT]: BIKE_UI_ADDRESS,
  [BIKE_MANAGER_CONTRACT]: BIKE_MANAGER_ADDRESS,
} as const

export function bikeAddressForContract(name: string): string {
  if (!Object.hasOwn(bikeContractAddresses, name)) {
    throw new Error(`unknown bike fixture contract: ${name}`)
  }

  return bikeContractAddresses[name as keyof typeof bikeContractAddresses]
}

export function bikeRouteResults(
  serialNumber: string,
  account: string,
): Record<string, unknown> {
  return {
    [BIKE_VIEW_ENTRY]: bikeEntryRouteResult(account),
    [BIKE_VIEW_COMPONENT]: bikeComponentRouteResult(serialNumber),
    [BIKE_VIEW_REGISTER]: bikeRegisterRouteResult(serialNumber),
  }
}

export function bikeEntryRouteResult(account: string): Record<string, unknown> {
  return {
    viewId: "entry",
    actions: ["lookupComponent", "openRegister"],
    account,
    canRegister: true,
    accountInfo: "Mock registrar account",
    serialNumber: "",
    exists: false,
    serialHash: BIKE_ZERO_BYTES32,
    tokenContract: BIKE_COMPONENTS_ADDRESS,
    tokenId: 0n,
    owner: account,
    ownerInfo: "",
    registrar: account,
    status: 0n,
    tokenURI: "",
    registeredAt: 0n,
    updatedAt: 0n,
    permissions: 0n,
    isOwner: false,
    canUpdateMetadata: false,
    canMarkMissing: false,
    canClearMissing: false,
    canRetire: false,
    componentsAddress: BIKE_COMPONENTS_ADDRESS,
  }
}

export function bikeComponentRouteResult(serialNumber: string): Record<string, unknown> {
  const exists = serialNumber.length > 0

  return {
    viewId: exists ? "component.found" : "component.empty",
    actions: exists ? ["markComponentMissing"] : ["lookupComponent", "openRegister"],
    account: BIKE_ACCOUNT_ADDRESS,
    canRegister: true,
    accountInfo: "Mock registrar account",
    exists,
    serialHash: exists
      ? "0x1111111111111111111111111111111111111111111111111111111111111111"
      : BIKE_ZERO_BYTES32,
    tokenContract: BIKE_COMPONENTS_ADDRESS,
    tokenId: exists ? 42n : 0n,
    owner: BIKE_ACCOUNT_ADDRESS,
    ownerInfo: "Mock owner account",
    registrar: BIKE_ACCOUNT_ADDRESS,
    status: exists ? 1n : 0n,
    tokenURI: exists ? `ipfs://example/token/${serialNumber}` : "",
    registeredAt: exists ? 1n : 0n,
    updatedAt: exists ? 2n : 0n,
    serialNumber,
    permissions: 7n,
    isOwner: true,
    canUpdateMetadata: exists,
    canMarkMissing: exists,
    canClearMissing: false,
    canRetire: exists,
    componentsAddress: BIKE_COMPONENTS_ADDRESS,
  }
}

export function bikeRegisterRouteResult(serialNumber: string): Record<string, unknown> {
  const hasSerialNumber = serialNumber.length > 0

  return {
    viewId: hasSerialNumber ? "register.ready" : "register.empty",
    actions: hasSerialNumber ? ["registerComponent"] : ["openRegister"],
    account: BIKE_ACCOUNT_ADDRESS,
    canRegister: true,
    exists: false,
    serialHash: hasSerialNumber
      ? "0x2222222222222222222222222222222222222222222222222222222222222222"
      : BIKE_ZERO_BYTES32,
    tokenId: 0n,
    componentsAddress: BIKE_COMPONENTS_ADDRESS,
    serialNumber,
    accountInfo: "Mock registrar account",
    tokenContract: BIKE_COMPONENTS_ADDRESS,
    owner: BIKE_ACCOUNT_ADDRESS,
    ownerInfo: "",
    registrar: BIKE_ACCOUNT_ADDRESS,
    status: 0n,
    tokenURI: "",
    registeredAt: 0n,
    updatedAt: 0n,
    permissions: 0n,
    isOwner: false,
    canUpdateMetadata: false,
    canMarkMissing: false,
    canClearMissing: false,
    canRetire: false,
  }
}

function bikeResourceURI(relativeURI: string): string {
  return new URL(relativeURI, BIKE_CAM_URI).href
}
