export const BIKE_HOST_CHAIN_ID = "eip155:31337"
export const BIKE_HOST_ADDRESS = "0x0000000000000000000000000000000000000001"
export const BIKE_ACCOUNT_ADDRESS = "0x0000000000000000000000000000000000000002"
export const BIKE_UI_ADDRESS = "0x0000000000000000000000000000000000000003"
export const BIKE_MANAGER_ADDRESS = "0x0000000000000000000000000000000000000004"
export const BIKE_COMPONENTS_ADDRESS = "0x0000000000000000000000000000000000000010"
export const BIKE_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export const BIKE_UI_CONTRACT = "BicycleComponentManagerUI"
export const BIKE_MANAGER_CONTRACT = "BicycleComponentManager"
export const BIKE_UI_NAMESPACE = `contracts.${BIKE_UI_CONTRACT}`
export const BIKE_MANAGER_NAMESPACE = `contracts.${BIKE_MANAGER_CONTRACT}`

type BikeFixtureAddress = `0x${string}`

export const BIKE_ROUTE_ENTRY = "entry"
export const BIKE_ROUTE_COMPONENT = "component"

export const BIKE_VIEW_ENTRY = "viewEntry"
export const BIKE_VIEW_COMPONENT = "viewComponent"
export const BIKE_VIEW_REGISTER = "viewRegister"
export const BIKE_MARK_MISSING = "markComponentMissing"

export const BIKE_CAM_URI = "ipfs://QmYwAPJzv5CZsnAzt8auVZRnJQt6P2JxC1ZyQ3GzFZ2q6x/main.json"

const BIKE_RELATIVE_UI_ABI_URI = "./abi/BicycleComponentManagerUI.json"
const BIKE_RELATIVE_MANAGER_ABI_URI = "./abi/BicycleComponentManager.json"
const BIKE_RELATIVE_UI_URI = "./ui.json"
export const BIKE_UI_ABI_URI = bikeResourceURI(BIKE_RELATIVE_UI_ABI_URI)
export const BIKE_MANAGER_ABI_URI = bikeResourceURI(BIKE_RELATIVE_MANAGER_ABI_URI)
export const BIKE_UI_URI = bikeResourceURI(BIKE_RELATIVE_UI_URI)

export const BIKE_SERIAL_NUMBER = "ABC123"
export const BIKE_UNKNOWN_SERIAL_NUMBER = "UNKNOWN123"
export const BIKE_ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000"
export const BIKE_SERIAL_HASH = "0x1111111111111111111111111111111111111111111111111111111111111111"
export const BIKE_UNKNOWN_SERIAL_HASH = "0x2222222222222222222222222222222222222222222222222222222222222222"
export const BIKE_TOKEN_ID = BigInt(BIKE_SERIAL_HASH)
export const BIKE_UNKNOWN_TOKEN_ID = BigInt(BIKE_UNKNOWN_SERIAL_HASH)
export const BIKE_UNSIGNED_CAM_HASH = BIKE_ZERO_BYTES32

export const bikeHost = {
  chainId: BIKE_HOST_CHAIN_ID,
  address: BIKE_HOST_ADDRESS,
} as const

export const bikeContractAddresses = {
  [BIKE_UI_CONTRACT]: BIKE_UI_ADDRESS,
  [BIKE_MANAGER_CONTRACT]: BIKE_MANAGER_ADDRESS,
} satisfies Record<typeof BIKE_UI_CONTRACT | typeof BIKE_MANAGER_CONTRACT, BikeFixtureAddress>

export function bikeAddressForContract(name: string): BikeFixtureAddress {
  switch (name) {
    case BIKE_UI_CONTRACT:
      return BIKE_UI_ADDRESS
    case BIKE_MANAGER_CONTRACT:
      return BIKE_MANAGER_ADDRESS
  }

  throw new Error(`unknown bike fixture contract: ${name}`)
}

export function bikeRouteResults(
  serialNumber: string,
  account: string,
): Record<string, unknown> {
  return {
    [BIKE_VIEW_ENTRY]: bikeEntryRouteResult(account),
    [BIKE_VIEW_COMPONENT]: bikeComponentRouteResult(serialNumber, account),
    [BIKE_VIEW_REGISTER]: bikeRegisterRouteResult(serialNumber, account),
  }
}

// This fixture mirrors the route projection in BicycleComponentManagerUI, not
// the whole manager. It deliberately models one registered active component and
// treats every other non-empty serial as unregistered.
export function bikeEntryRouteResult(account: string): Record<string, unknown> {
  const canRegister = bikeCanRegister(account)

  return {
    viewId: "entry",
    actions: lookupAndRegisterActions(),
    account,
    canRegister,
    accountInfo: bikeAccountInfo(account),
    serialNumber: "",
    exists: false,
    serialHash: BIKE_ZERO_BYTES32,
    tokenContract: BIKE_ZERO_ADDRESS,
    tokenId: 0n,
    owner: BIKE_ZERO_ADDRESS,
    ownerInfo: "",
    registrar: BIKE_ZERO_ADDRESS,
    statusId: "none",
    tokenURI: "",
    registeredAt: 0n,
    updatedAt: 0n,
    permissions: 0n,
    isOwner: false,
    canUpdateMetadata: false,
    canMarkMissing: false,
    canClearMissing: false,
    canRetire: false,
    componentsAddress: BIKE_ZERO_ADDRESS,
  }
}

export function bikeComponentRouteResult(
  serialNumber: string,
  account: string,
): Record<string, unknown> {
  const exists = serialNumber === BIKE_SERIAL_NUMBER
  const empty = serialNumber.length === 0
  const canAct = exists && account === BIKE_ACCOUNT_ADDRESS

  return {
    viewId: empty ? "component.empty" : exists ? "component.found" : "component.notFound",
    actions: exists ? componentActions(canAct) : lookupAndRegisterActions(),
    account,
    canRegister: bikeCanRegister(account),
    accountInfo: bikeAccountInfo(account),
    exists,
    serialHash: exists
      ? BIKE_SERIAL_HASH
      : empty ? BIKE_ZERO_BYTES32 : BIKE_UNKNOWN_SERIAL_HASH,
    tokenContract: exists ? BIKE_COMPONENTS_ADDRESS : BIKE_ZERO_ADDRESS,
    tokenId: exists ? BIKE_TOKEN_ID : empty ? 0n : BIKE_UNKNOWN_TOKEN_ID,
    owner: exists ? BIKE_ACCOUNT_ADDRESS : BIKE_ZERO_ADDRESS,
    ownerInfo: exists ? "Mock owner account" : "",
    registrar: exists ? BIKE_ACCOUNT_ADDRESS : BIKE_ZERO_ADDRESS,
    statusId: exists ? "active" : "none",
    tokenURI: exists ? `ipfs://example/token/${serialNumber}` : "",
    registeredAt: exists ? 1n : 0n,
    updatedAt: exists ? 2n : 0n,
    serialNumber,
    permissions: canAct ? 15n : 0n,
    isOwner: canAct,
    canUpdateMetadata: canAct,
    canMarkMissing: canAct,
    canClearMissing: false,
    canRetire: canAct,
    componentsAddress: BIKE_ZERO_ADDRESS,
  }
}

export function bikeRegisterRouteResult(
  serialNumber: string,
  account: string,
): Record<string, unknown> {
  const hasSerialNumber = serialNumber.length > 0
  const exists = serialNumber === BIKE_SERIAL_NUMBER
  const canRegister = bikeCanRegister(account)
  const ready = hasSerialNumber && canRegister && !exists

  return {
    viewId: !hasSerialNumber ? "register.empty" : ready ? "register.ready" : "register.blocked",
    actions: ready
      ? registerReadyActions()
      : hasSerialNumber ? lookupOnlyActions() : lookupAndRegisterActions(),
    account,
    canRegister,
    exists,
    serialHash: hasSerialNumber ? exists ? BIKE_SERIAL_HASH : BIKE_UNKNOWN_SERIAL_HASH : BIKE_ZERO_BYTES32,
    tokenId: exists ? BIKE_TOKEN_ID : hasSerialNumber ? BIKE_UNKNOWN_TOKEN_ID : 0n,
    componentsAddress: BIKE_COMPONENTS_ADDRESS,
    serialNumber,
    accountInfo: bikeAccountInfo(account),
    tokenContract: BIKE_ZERO_ADDRESS,
    owner: BIKE_ZERO_ADDRESS,
    ownerInfo: "",
    registrar: BIKE_ZERO_ADDRESS,
    statusId: "none",
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

function bikeCanRegister(account: string): boolean {
  return account === BIKE_ACCOUNT_ADDRESS
}

function bikeAccountInfo(account: string): string {
  return bikeCanRegister(account) ? "Mock registrar account" : ""
}

function lookupAndRegisterActions(): string[] {
  return ["lookupComponent", "openRegister"]
}

function lookupOnlyActions(): string[] {
  return ["lookupComponent"]
}

function registerReadyActions(): string[] {
  return ["registerComponent", "lookupComponent"]
}

function componentActions(canAct: boolean): string[] {
  if (!canAct) {
    return lookupOnlyActions()
  }

  return ["lookupComponent", "updateComponentMetadata", "markComponentMissing", "retireComponent"]
}

function bikeResourceURI(relativeURI: string): string {
  return new URL(relativeURI, BIKE_CAM_URI).href
}
