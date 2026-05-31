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
export const BIKE_MARK_MISSING = "markMissing"

export const BIKE_CAM_URI = "ipfs://example/main.json"

export const BIKE_RELATIVE_UI_ABI_URI = "./abi/BicycleComponentManagerUI.json"
export const BIKE_RELATIVE_MANAGER_ABI_URI = "./abi/BicycleComponentManager.json"
export const BIKE_UI_ABI_URI = bikeResourceURI(BIKE_RELATIVE_UI_ABI_URI)
export const BIKE_MANAGER_ABI_URI = bikeResourceURI(BIKE_RELATIVE_MANAGER_ABI_URI)

export const BIKE_RELATIVE_ENTRY_SCREEN_URI = "./screens/entry.json"
export const BIKE_RELATIVE_COMPONENT_EMPTY_SCREEN_URI = "./screens/component.empty.json"
export const BIKE_RELATIVE_COMPONENT_FOUND_SCREEN_URI = "./screens/component.found.json"
export const BIKE_RELATIVE_COMPONENT_NOT_FOUND_SCREEN_URI = "./screens/component.not-found.json"
export const BIKE_RELATIVE_REGISTER_EMPTY_SCREEN_URI = "./screens/register.empty.json"
export const BIKE_RELATIVE_REGISTER_READY_SCREEN_URI = "./screens/register.ready.json"
export const BIKE_RELATIVE_REGISTER_BLOCKED_SCREEN_URI = "./screens/register.blocked.json"

export const BIKE_ENTRY_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_ENTRY_SCREEN_URI)
export const BIKE_COMPONENT_EMPTY_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_COMPONENT_EMPTY_SCREEN_URI)
export const BIKE_COMPONENT_FOUND_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_COMPONENT_FOUND_SCREEN_URI)
export const BIKE_COMPONENT_NOT_FOUND_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_COMPONENT_NOT_FOUND_SCREEN_URI)
export const BIKE_REGISTER_EMPTY_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_REGISTER_EMPTY_SCREEN_URI)
export const BIKE_REGISTER_READY_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_REGISTER_READY_SCREEN_URI)
export const BIKE_REGISTER_BLOCKED_SCREEN_URI = bikeResourceURI(BIKE_RELATIVE_REGISTER_BLOCKED_SCREEN_URI)

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

const accountViewOutput = {
  name: "accountView",
  type: "tuple",
  components: [
    { name: "account", type: "address" },
    { name: "canRegister", type: "bool" },
    { name: "accountInfo", type: "string" },
  ],
} as const

const componentViewOutput = {
  name: "component",
  type: "tuple",
  components: [
    { name: "exists", type: "bool" },
    { name: "serialHash", type: "bytes32" },
    { name: "tokenContract", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "ownerInfo", type: "string" },
    { name: "registrar", type: "address" },
    { name: "status", type: "uint8" },
    { name: "tokenURI", type: "string" },
    { name: "registeredAt", type: "uint48" },
    { name: "updatedAt", type: "uint48" },
    { name: "serialNumber", type: "string" },
    { name: "permissions", type: "uint64" },
    { name: "isOwner", type: "bool" },
    { name: "canUpdateMetadata", type: "bool" },
    { name: "canMarkMissing", type: "bool" },
    { name: "canClearMissing", type: "bool" },
    { name: "canRetire", type: "bool" },
  ],
} as const

const registerViewOutput = {
  name: "registerView",
  type: "tuple",
  components: [
    { name: "canRegister", type: "bool" },
    { name: "exists", type: "bool" },
    { name: "serialHash", type: "bytes32" },
    { name: "tokenId", type: "uint256" },
    { name: "componentsAddress", type: "address" },
    { name: "serialNumber", type: "string" },
    { name: "accountInfo", type: "string" },
  ],
} as const

export const bikeUiAbi = [
  {
    type: "function",
    name: BIKE_VIEW_ENTRY,
    stateMutability: "view",
    inputs: [{ name: "viewer", type: "address" }],
    outputs: [{ name: "screenURI", type: "string" }, accountViewOutput],
  },
  {
    type: "function",
    name: BIKE_VIEW_COMPONENT,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }, componentViewOutput, accountViewOutput],
  },
  {
    type: "function",
    name: BIKE_VIEW_REGISTER,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "viewer", type: "address" },
    ],
    outputs: [{ name: "screenURI", type: "string" }, registerViewOutput, accountViewOutput],
  },
] as const

export const bikeManagerAbi = [
  {
    type: "function",
    name: BIKE_MARK_MISSING,
    stateMutability: "nonpayable",
    inputs: [{ name: "serialNumber", type: "string" }],
    outputs: [],
  },
] as const

export const bikeEntryScreen = {
  screen: "1.0.0",
  title: "Entry",
  elements: [
    {
      type: "input",
      name: "serialNumber",
      label: "Serial number",
      value: "",
    },
    {
      type: "status",
      label: "Can register",
      value: "$values.0.canRegister",
    },
  ],
} as const

export const bikeComponentScreen = {
  screen: "1.0.0",
  title: "Component",
  elements: [
    {
      type: "status",
      label: "Serial number",
      value: "$values.0.serialNumber",
    },
  ],
} as const

export const bikeRegisterScreen = {
  screen: "1.0.0",
  title: "Register",
  elements: [
    {
      type: "status",
      label: "Can register",
      value: "$values.0.canRegister",
    },
  ],
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
): Record<string, readonly unknown[]> {
  return {
    [BIKE_VIEW_ENTRY]: bikeEntryRouteResult(account),
    [BIKE_VIEW_COMPONENT]: bikeComponentRouteResult(serialNumber),
    [BIKE_VIEW_REGISTER]: bikeRegisterRouteResult(serialNumber),
  }
}

export function bikeEntryRouteResult(account: string): readonly unknown[] {
  return [
    BIKE_RELATIVE_ENTRY_SCREEN_URI,
    {
      account,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

export function bikeComponentRouteResult(serialNumber: string): readonly unknown[] {
  const exists = serialNumber.length > 0
  const screenURI = exists
    ? BIKE_RELATIVE_COMPONENT_FOUND_SCREEN_URI
    : BIKE_RELATIVE_COMPONENT_EMPTY_SCREEN_URI

  return [
    screenURI,
    {
      exists,
      serialHash: exists
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : BIKE_ZERO_BYTES32,
      tokenContract: BIKE_COMPONENTS_ADDRESS,
      tokenId: exists ? 42 : 0,
      owner: BIKE_ACCOUNT_ADDRESS,
      ownerInfo: "Mock owner account",
      registrar: BIKE_ACCOUNT_ADDRESS,
      status: exists ? 1 : 0,
      tokenURI: exists ? `ipfs://example/token/${serialNumber}` : "",
      registeredAt: exists ? 1 : 0,
      updatedAt: exists ? 2 : 0,
      serialNumber,
      permissions: 7,
      isOwner: true,
      canUpdateMetadata: exists,
      canMarkMissing: exists,
      canClearMissing: false,
      canRetire: exists,
    },
    {
      account: BIKE_ACCOUNT_ADDRESS,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

export function bikeRegisterRouteResult(serialNumber: string): readonly unknown[] {
  const hasSerialNumber = serialNumber.length > 0
  const screenURI = hasSerialNumber
    ? BIKE_RELATIVE_REGISTER_READY_SCREEN_URI
    : BIKE_RELATIVE_REGISTER_EMPTY_SCREEN_URI

  return [
    screenURI,
    {
      canRegister: true,
      exists: false,
      serialHash: hasSerialNumber
        ? "0x2222222222222222222222222222222222222222222222222222222222222222"
        : BIKE_ZERO_BYTES32,
      tokenId: 0,
      componentsAddress: BIKE_COMPONENTS_ADDRESS,
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

function bikeResourceURI(relativeURI: string): string {
  return new URL(relativeURI, BIKE_CAM_URI).href
}
