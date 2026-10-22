import { readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import assert from "node:assert/strict"
import {
  BIKE_ACCOUNT_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_SERIAL_NUMBER,
  BIKE_CAM_URI, BIKE_MANAGER_ADDRESS, BIKE_UI_ADDRESS, BIKE_TOKEN_ID,
  bikeHost, bikeContractAddresses, bikeComponentRouteResult,
} from "./bike.mts"
import { bikeCamBytes, bikeUiAbi } from "./bike-resources.mts"
import { createMockCamPublicClient } from "./mock.mts"

export const WORKSHOP = "0x0000000000000000000000000000000000000031"
export const OTHER_WORKSHOP = "0x0000000000000000000000000000000000000032"
export const BUYER = "0x0000000000000000000000000000000000000041"
export const CURRENT_COLLECTION = "0x0000000000000000000000000000000000000051"
export const PREVIEW_EXPIRY = "2000003600"

// Proposed projection values, not a replacement manifest. Every consumer loads
// the checked-in Bike publication. Solidity scenarios separately pin projection
// availability and the real manager/ERC721 transitions.
export function ownerComponentView(overrides: Record<string, unknown> = {}) {
  return {
    ...bikeComponentRouteResult(BIKE_SERIAL_NUMBER, BIKE_ACCOUNT_ADDRESS, "active"),
    tokenContract: BIKE_COMPONENTS_ADDRESS,
    componentsAddress: CURRENT_COLLECTION,
    canTransfer: true,
    inactive: false,
    actions: ["lookupComponent", "delegation", "transferComponent"],
    ...overrides,
  }
}

export function workshopView(overrides: Record<string, unknown> = {}) {
  return {
    viewId: "delegation",
    account: BIKE_ACCOUNT_ADDRESS,
    paused: false,
    componentTokenPaused: false,
    serialNumber: BIKE_SERIAL_NUMBER,
    owner: BIKE_ACCOUNT_ADDRESS,
    isOwner: true,
    delegate: WORKSHOP,
    delegationGrantor: BIKE_ACCOUNT_ADDRESS,
    delegationCapabilities: "1",
    delegationValidUntil: PREVIEW_EXPIRY,
    delegationActive: true,
    duration: "3600",
    maxDelegationDuration: "2592000", // This test deployment configures a 30-day cap.
    validUntil: PREVIEW_EXPIRY,
    actions: ["lookupComponent", "delegation", "setComponentDelegate", "revokeComponentDelegate"],
    ...overrides,
  }
}

export function ownerWorkflowSessionOptions() {
  // Diagnose unpublished roadmap fields before the strict ABI normalizer could
  // turn a missing feature into a misleading "unexpected fixture property".
  assertPublishedProjection("viewComponent", ownerComponentView(), ["inactive", "canTransfer", "maxDelegationDuration"])
  let owner: `0x${string}` = BIKE_ACCOUNT_ADDRESS
  let paused = false
  let maxDelegationDuration = 2592000n
  const reads: { functionName: string; args?: readonly unknown[] }[] = []
  const base = createMockCamPublicClient({
    chainId: 31337, camURI: BIKE_CAM_URI, camHash: `0x${createHash("sha256").update(bikeCamBytes).digest("hex")}`, supportsCamInterface: true,
    addresses: { ...bikeContractAddresses, BicycleComponents: CURRENT_COLLECTION }, routeResults: {},
  })
  const publicClient = {
    getChainId: base.getChainId,
    async readContract(request: Parameters<typeof base.readContract>[0]): Promise<unknown> {
      reads.push({ functionName: request.functionName, ...(request.args ? { args: request.args } : {}) })
      if (request.functionName === "viewComponent") {
        assertAddress(request.address, BIKE_UI_ADDRESS)
        const isOwner = request.args?.[1] === owner
        return ownerComponentView({
          owner, account: request.args?.[1], isOwner,
          authorityId: isOwner ? "owner" : "none",
          permissions: isOwner ? 7n : 0n,
          canRegister: false,
          accountInfo: "",
          canUpdateMetadata: isOwner,
          canMarkMissing: isOwner,
          canClearMissing: false,
          maxDelegationDuration,
          componentTokenPaused: paused,
          canTransfer: isOwner && !paused,
          actions: isOwner && !paused ? ["lookupComponent", "delegation", "transferComponent", "updateComponentMetadata"] : ["lookupComponent"],
        })
      }
      if (request.functionName === "viewDelegation") {
        assertAddress(request.address, BIKE_UI_ADDRESS)
        assertPublishedProjection("viewDelegation", workshopView(), ["delegate", "duration", "maxDelegationDuration", "validUntil"])
        const duration = request.args?.[3]
        assert.ok(typeof duration === "bigint")
        return workshopView({
          delegate: request.args?.[1], account: request.args?.[2],
          delegationCapabilities: 1n,
          delegationValidUntil: BigInt(PREVIEW_EXPIRY),
          duration, maxDelegationDuration,
          validUntil: 2000000000n + duration,
        })
      }
      if (request.functionName === "tokenReference") {
        assertAddress(request.address, BIKE_MANAGER_ADDRESS)
        if (request.args?.[0] !== BIKE_SERIAL_NUMBER) throw new Error("Handover changed the loaded serial")
        return [BIKE_COMPONENTS_ADDRESS, BIKE_TOKEN_ID]
      }
      return base.readContract(request)
    },
  }
  return {
    options: {
      publicClient, host: bikeHost, account: { address: BIKE_ACCOUNT_ADDRESS } as const, route: "component", inputs: { serialNumber: BIKE_SERIAL_NUMBER },
      async loadResource(uri: string): Promise<Uint8Array> {
        const prefix = BIKE_CAM_URI.slice(0, BIKE_CAM_URI.lastIndexOf("/") + 1)
        if (!uri.startsWith(prefix)) throw new Error(`Unexpected Bike test resource: ${uri}`)
        const path = uri.slice(prefix.length)
        if (path.includes("..")) throw new Error("Unexpected relative resource")
        return new Uint8Array(await readFile(new URL(`../../../dapps/bike-nft/cam/${path}`, import.meta.url)))
      },
    },
    reads,
    confirmTransfer() { owner = BUYER },
    pauseRecordToken() { paused = true },
    setMaxDelegationDuration(duration: bigint) { maxDelegationDuration = duration },
  }
}

function assertAddress(actual: string, expected: string) {
  if (actual !== expected) throw new Error(`Unexpected contract target: ${actual}; expected ${expected}`)
}

function assertPublishedProjection(functionName: string, fixture: Record<string, unknown>, requiredFields: readonly string[]) {
  const fn = bikeUiAbi.find(item => item.type === "function" && item.name === functionName)
  assert.ok(fn, `Bike ABI is missing owner-workflow projection ${functionName}`)
  assert.ok(Array.isArray(fn.outputs) && fn.outputs.length === 1, `${functionName} must return one view tuple`)
  const output = fn.outputs[0] as { components?: unknown }
  assert.ok(Array.isArray(output.components), `${functionName} must publish its view tuple fields`)
  const names = output.components.map((component: { name: string }) => component.name)
  for (const name of requiredFields) assert.ok(names.includes(name), `Bike ABI is missing owner-workflow field ${functionName}.${name}`)
  assert.deepEqual(Object.keys(fixture).sort(), [...names].sort(), `${functionName} test projection must match the published ABI exactly`)
}
