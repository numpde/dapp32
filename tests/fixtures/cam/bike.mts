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

export const bikeCamJson = {
  cam: "1.0.0",
  entry: BIKE_ROUTE_ENTRY,
  namespaces: {
    [BIKE_UI_NAMESPACE]: {
      type: "contract",
      abiURI: BIKE_RELATIVE_UI_ABI_URI,
    },
    [BIKE_MANAGER_NAMESPACE]: {
      type: "contract",
      abiURI: BIKE_RELATIVE_MANAGER_ABI_URI,
    },
    [BIKE_ROUTES_NAMESPACE]: {
      type: "routes",
    },
    [BIKE_UI_RESOURCE_NAMESPACE]: {
      type: "ui",
      uri: "./ui.json",
    },
  },
  routes: {
    [BIKE_ROUTE_ENTRY]: {
      inputs: [],
      call: {
        namespace: BIKE_UI_NAMESPACE,
        function: BIKE_VIEW_ENTRY,
        args: {
          account: "$account.address",
        },
      },
      then: {
        namespace: BIKE_UI_RESOURCE_NAMESPACE,
        function: "app",
        args: {
          form: "$form",
          view: "$outputs.0",
        },
      },
    },
    [BIKE_ROUTE_COMPONENT]: {
      inputs: ["serialNumber"],
      call: {
        namespace: BIKE_UI_NAMESPACE,
        function: BIKE_VIEW_COMPONENT,
        args: {
          serialNumber: "$inputs.serialNumber",
          account: "$account.address",
        },
      },
      then: {
        namespace: BIKE_UI_RESOURCE_NAMESPACE,
        function: "app",
        args: {
          form: "$form",
          view: "$outputs.0",
        },
      },
    },
    [BIKE_ROUTE_REGISTER]: {
      inputs: ["serialNumber"],
      call: {
        namespace: BIKE_UI_NAMESPACE,
        function: BIKE_VIEW_REGISTER,
        args: {
          serialNumber: "$inputs.serialNumber",
          account: "$account.address",
        },
      },
      then: {
        namespace: BIKE_UI_RESOURCE_NAMESPACE,
        function: "app",
        args: {
          form: "$form",
          view: "$outputs.0",
        },
      },
    },
    markComponentMissing: {
      inputs: ["serialNumber"],
      call: {
        namespace: BIKE_MANAGER_NAMESPACE,
        function: BIKE_MARK_MISSING,
        args: {
          serialNumber: "$inputs.serialNumber",
        },
      },
      then: {
        namespace: BIKE_ROUTES_NAMESPACE,
        function: BIKE_ROUTE_COMPONENT,
        args: {
          serialNumber: "$inputs.serialNumber",
        },
      },
    },
  },
} as const

const appViewOutput = {
  name: "view",
  type: "tuple",
  components: [
    { name: "viewId", type: "string" },
    { name: "actions", type: "string[]" },
    { name: "account", type: "address" },
    { name: "canRegister", type: "bool" },
    { name: "accountInfo", type: "string" },
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
    { name: "componentsAddress", type: "address" },
    { name: "tokenURI", type: "string" },
  ],
} as const

export const bikeUiAbi = [
  {
    type: "function",
    name: BIKE_VIEW_ENTRY,
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [appViewOutput],
  },
  {
    type: "function",
    name: BIKE_VIEW_COMPONENT,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "account", type: "address" },
    ],
    outputs: [appViewOutput],
  },
  {
    type: "function",
    name: BIKE_VIEW_REGISTER,
    stateMutability: "view",
    inputs: [
      { name: "serialNumber", type: "string" },
      { name: "account", type: "address" },
    ],
    outputs: [appViewOutput],
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

export const bikeUiJson = {
  ui: "1.0.0",
  app: {
    tag: "Screen",
    requires: ["form", "view"],
    props: {
      title: "Bicycle component registry",
    },
    children: [
      {
        tag: "Include",
        call: {
          namespace: "ui",
          function: "$view.viewId",
          args: {
            view: "$view",
          },
        },
      },
      {
        tag: "Include",
        call: {
          namespace: "ui",
          function: "$view.actions",
          args: {
            form: "$form",
          },
        },
      },
    ],
  },
  entry: {
    tag: "Fragment",
    requires: ["view"],
    children: [
      {
        tag: "Input",
        props: {
          name: "serialNumber",
          label: "Serial number",
          value: "$view.serialNumber",
        },
      },
    ],
  },
  "component.found": {
    tag: "Fragment",
    requires: ["view"],
    children: [
      {
        tag: "Input",
        props: {
          name: "serialNumber",
          label: "Serial number",
          value: "$view.serialNumber",
        },
      },
      {
        tag: "Status",
        props: {
          label: "Status",
          value: "$view.status",
        },
      },
    ],
  },
  "register.ready": {
    tag: "Fragment",
    requires: ["view"],
    children: [
      {
        tag: "Input",
        props: {
          name: "serialNumber",
          label: "Serial number",
          value: "$view.serialNumber",
        },
      },
      {
        tag: "Input",
        props: {
          name: "tokenURI",
          label: "Token URI",
          value: "$view.tokenURI",
        },
      },
    ],
  },
  lookupComponent: {
    tag: "Action",
    requires: ["form"],
    props: {
      label: "Look up component",
    },
    call: {
      namespace: "routes",
      function: BIKE_ROUTE_COMPONENT,
      args: {
        serialNumber: "$form.serialNumber",
      },
    },
  },
  openRegister: {
    tag: "Action",
    requires: ["form"],
    props: {
      label: "Register component",
    },
    call: {
      namespace: "routes",
      function: BIKE_ROUTE_REGISTER,
      args: {
        serialNumber: "$form.serialNumber",
      },
    },
  },
  markComponentMissing: {
    tag: "Action",
    requires: ["form"],
    props: {
      label: "Prepare missing report",
    },
    call: {
      namespace: "routes",
      function: "markComponentMissing",
      args: {
        serialNumber: "$form.serialNumber",
      },
    },
  },
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
    {
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
    },
  ]
}

export function bikeComponentRouteResult(serialNumber: string): readonly unknown[] {
  const exists = serialNumber.length > 0

  return [
    {
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
    },
  ]
}

export function bikeRegisterRouteResult(serialNumber: string): readonly unknown[] {
  const hasSerialNumber = serialNumber.length > 0

  return [
    {
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
    },
  ]
}

function bikeResourceURI(relativeURI: string): string {
  return new URL(relativeURI, BIKE_CAM_URI).href
}
