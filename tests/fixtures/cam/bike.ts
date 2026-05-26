export const BIKE_HOST_CHAIN_ID = "eip155:31337"
export const BIKE_HOST_ADDRESS = "0x0000000000000000000000000000000000000001"
export const BIKE_ACCOUNT_ADDRESS = "0x0000000000000000000000000000000000000002"
export const BIKE_UI_ADDRESS = "0x0000000000000000000000000000000000000003"
export const BIKE_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000004"
export const BIKE_COMPONENTS_ADDRESS = "0x0000000000000000000000000000000000000010"

export const BIKE_UI_CONTRACT = "BicycleComponentManagerUI"
export const BIKE_MANAGER_CONTRACT = "BicycleComponentManager"

export const BIKE_ROUTE_ENTRY = "entry"
export const BIKE_ROUTE_COMPONENT = "component"
export const BIKE_ROUTE_REGISTER = "register"

export const BIKE_VIEW_ENTRY = "viewEntry"
export const BIKE_VIEW_COMPONENT = "viewComponent"
export const BIKE_VIEW_REGISTER = "viewRegister"

export const BIKE_CAM_URI = "ipfs://example/main.json"
export const BIKE_UI_ABI_URI = "ipfs://example/abi/BicycleComponentManagerUI.json"
export const BIKE_MANAGER_ABI_URI = "ipfs://example/abi/BicycleComponentManager.json"

export const BIKE_RELATIVE_UI_ABI_URI = "./abi/BicycleComponentManagerUI.json"
export const BIKE_RELATIVE_MANAGER_ABI_URI = "./abi/BicycleComponentManager.json"

export const BIKE_RELATIVE_ENTRY_SCREEN_URI = "./screens/entry.json"
export const BIKE_RELATIVE_COMPONENT_SCREEN_URI = "./screens/component.json"
export const BIKE_RELATIVE_REGISTER_SCREEN_URI = "./screens/register.json"

export const BIKE_ENTRY_SCREEN_URI = "ipfs://example/screens/entry.json"
export const BIKE_COMPONENT_SCREEN_URI = "ipfs://example/screens/component.json"
export const BIKE_REGISTER_SCREEN_URI = "ipfs://example/screens/register.json"

export const BIKE_SERIAL_NUMBER = "ABC123"

export const bikeHost = {
  chainId: BIKE_HOST_CHAIN_ID,
  address: BIKE_HOST_ADDRESS,
} as const

export const bikeContractAddresses = {
  [BIKE_UI_CONTRACT]: BIKE_UI_ADDRESS,
  [BIKE_MANAGER_CONTRACT]: BIKE_MANAGER_ADDRESS,
} as const

export const bikeCamJson = {
  cam: "1.0.0",
  entry: BIKE_ROUTE_ENTRY,
  contracts: {
    [BIKE_UI_CONTRACT]: {
      abiURI: BIKE_RELATIVE_UI_ABI_URI,
    },
    [BIKE_MANAGER_CONTRACT]: {
      abiURI: BIKE_RELATIVE_MANAGER_ABI_URI,
    },
  },
  routes: {
    [BIKE_ROUTE_ENTRY]: {
      contract: BIKE_UI_CONTRACT,
      function: BIKE_VIEW_ENTRY,
      args: ["$account.address"],
    },
    [BIKE_ROUTE_COMPONENT]: {
      contract: BIKE_UI_CONTRACT,
      function: BIKE_VIEW_COMPONENT,
      args: ["$params.serialNumber", "$account.address"],
    },
    [BIKE_ROUTE_REGISTER]: {
      contract: BIKE_UI_CONTRACT,
      function: BIKE_VIEW_REGISTER,
      args: ["$params.serialNumber", "$account.address"],
    },
  },
} as const

export const bikeUiAbi = [
  {
    type: "function",
    name: BIKE_VIEW_ENTRY,
    stateMutability: "view",
    inputs: [{ name: "viewer", type: "address" }],
    outputs: [{ name: "screenURI", type: "string" }],
  },
  {
    type: "function",
    name: BIKE_VIEW_COMPONENT,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }],
  },
  {
    type: "function",
    name: BIKE_VIEW_REGISTER,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }],
  },
] as const

export const bikeManagerAbi = [] as const

export function bikeAddressForContract(name: string): string {
  return Object.hasOwn(bikeContractAddresses, name)
    ? bikeContractAddresses[name as keyof typeof bikeContractAddresses]
    : "0x0000000000000000000000000000000000000000"
}

// TODO(inert-values): fixture route results should mirror the production
// adapter boundary and return readonly InertValue[] once EVM values are
// normalized above viem.
// TODO(silent-defaults): the default serial number keeps tests terse, but
// callers that care about route input should pass the serial explicitly.
export function bikeRouteResults(serialNumber = BIKE_SERIAL_NUMBER): Record<string, readonly unknown[]> {
  return {
    [BIKE_VIEW_ENTRY]: bikeEntryRouteResult(),
    [BIKE_VIEW_COMPONENT]: bikeComponentRouteResult(serialNumber),
    [BIKE_VIEW_REGISTER]: bikeRegisterRouteResult(serialNumber),
  }
}

// TODO(inert-values): this mocked ABI return crosses into screen/viewer tests;
// keep it aligned with the eventual RouteResult.values inert-value type.
// TODO(silent-defaults): entry account defaults are fixture convenience, not a
// protocol rule; tests for account-sensitive behavior should pass it explicitly.
export function bikeEntryRouteResult(account = BIKE_ACCOUNT_ADDRESS): readonly unknown[] {
  return [
    BIKE_RELATIVE_ENTRY_SCREEN_URI,
    {
      account,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

// TODO(inert-values): component view data is currently plain fixture data, but
// should be typed as inert route output when the route boundary is migrated.
// TODO(silent-defaults): component route tests should pass the serial number
// explicitly when the input matters.
export function bikeComponentRouteResult(serialNumber = BIKE_SERIAL_NUMBER): readonly unknown[] {
  return [
    BIKE_RELATIVE_COMPONENT_SCREEN_URI,
    {
      exists: serialNumber.length > 0,
      serialHash: serialNumber.length > 0
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenContract: BIKE_COMPONENTS_ADDRESS,
      tokenId: serialNumber.length > 0 ? 42 : 0,
      owner: BIKE_ACCOUNT_ADDRESS,
      ownerInfo: "Mock owner account",
      registrar: BIKE_ACCOUNT_ADDRESS,
      status: serialNumber.length > 0 ? 1 : 0,
      tokenURI: serialNumber.length > 0 ? `ipfs://example/token/${serialNumber}` : "",
      registeredAt: serialNumber.length > 0 ? 1 : 0,
      updatedAt: serialNumber.length > 0 ? 2 : 0,
      serialNumber,
      permissions: 7,
      isOwner: true,
      canUpdateMetadata: serialNumber.length > 0,
      canMarkMissing: serialNumber.length > 0,
      canClearMissing: false,
      canRetire: serialNumber.length > 0,
    },
    {
      account: BIKE_ACCOUNT_ADDRESS,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

// TODO(inert-values): register view data follows the same route-output
// boundary as the real UI helper contract.
// TODO(silent-defaults): register route tests should pass the serial number
// explicitly when the input matters.
export function bikeRegisterRouteResult(serialNumber = BIKE_SERIAL_NUMBER): readonly unknown[] {
  return [
    BIKE_RELATIVE_REGISTER_SCREEN_URI,
    {
      canRegister: true,
      exists: false,
      serialHash: serialNumber.length > 0
        ? "0x2222222222222222222222222222222222222222222222222222222222222222"
        : "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenId: 0,
      defaultComponents: BIKE_COMPONENTS_ADDRESS,
      serialNumber,
      accountInfo: "Mock registrar account",
    },
    {
      account: BIKE_ACCOUNT_ADDRESS,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}
