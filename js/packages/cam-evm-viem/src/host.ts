import { parseCam } from "@cam/core"
import { parseJsonBytes } from "@cam/protocol"
import type { Hex } from "viem"

import { CAM_ROOT_FUNCTIONS, ICAM_APP_INTERFACE_ID, camRootAbi } from "./abi.ts"
import { assertClientChain } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamHash } from "./hash.ts"
import { loadResourceBytes } from "./resources.ts"
import type { LoadedCam, LoadCamFromHostOptions } from "./types.ts"

export async function loadCamFromHost({
  publicClient,
  host,
  loadResource,
  allowUnsignedCamHash,
}: LoadCamFromHostOptions): Promise<LoadedCam> {
  await assertClientChain(publicClient, host)
  await assertCamHostInterface(publicClient, host.address)

  let camURI: string
  let camHash: Hex
  try {
    const [rawCamURI, rawCamHash] = await Promise.all([
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: CAM_ROOT_FUNCTIONS.camURI,
      }),
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: CAM_ROOT_FUNCTIONS.camHash,
      }),
    ])
    camURI = requireStringRootValue(rawCamURI, CAM_ROOT_FUNCTIONS.camURI)
    camHash = requireBytes32RootValue(rawCamHash, CAM_ROOT_FUNCTIONS.camHash)
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to read CAM host: ${host.address}`, cause)
  }

  const camBytes = await loadResourceBytes(
    loadResource,
    camURI,
    `failed to load CAM resource: ${camURI}`,
  )

  verifyCamHash({
    bytes: camBytes,
    expectedHash: camHash,
    allowUnsigned: allowUnsignedCamHash,
  })

  let camJson: unknown
  try {
    camJson = parseJsonBytes(camBytes)
  } catch (cause) {
    throw new CamEvmError("CAM_DOCUMENT_INVALID", `CAM document is not valid JSON: ${camURI}`, cause)
  }
  const cam = parseCam(camJson)

  return {
    camURI,
    cam,
  }
}

async function assertCamHostInterface(
  publicClient: LoadCamFromHostOptions["publicClient"],
  hostAddress: LoadCamFromHostOptions["host"]["address"],
): Promise<void> {
  let supported: unknown
  try {
    supported = await publicClient.readContract({
      address: hostAddress,
      abi: camRootAbi,
      functionName: CAM_ROOT_FUNCTIONS.supportsInterface,
      args: [ICAM_APP_INTERFACE_ID],
    })
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to check CAM host interface: ${hostAddress}`, cause)
  }

  if (supported !== true) {
    throw new CamEvmError("CAM_HOST_UNSUPPORTED", `CAM host does not support ICamApp: ${hostAddress}`)
  }
}

function requireStringRootValue(value: unknown, functionName: string): string {
  if (typeof value !== "string") {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `CAM host ${functionName} returned a non-string value`)
  }

  return value
}

function requireBytes32RootValue(value: unknown, functionName: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `CAM host ${functionName} returned a non-bytes32 value`)
  }

  // The regex proves viem's Hex template shape; TypeScript cannot infer that
  // from a runtime regular expression.
  return value as Hex
}
