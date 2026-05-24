import { parseCam } from "@cam/core"
import type { Hex } from "viem"

import { camRootAbi } from "./abi.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamHash } from "./hash.ts"
import type { LoadedCam, LoadCamFromHostOptions } from "./types.ts"

export async function loadCamFromHost({
  publicClient,
  host,
  loadResource,
}: LoadCamFromHostOptions): Promise<LoadedCam> {
  let rootValues: readonly unknown[]
  try {
    rootValues = await Promise.all([
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: "camURI",
      }),
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: "camHash",
      }),
    ])
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to read CAM host: ${host.address}`, cause)
  }

  const [camURI, camHash] = rootValues as [string, Hex]

  let camBytes: Uint8Array
  try {
    camBytes = await loadResource(camURI)
  } catch (cause) {
    throw new CamEvmError("CAM_RESOURCE_LOAD_FAILED", `failed to load CAM resource: ${camURI}`, cause)
  }

  verifyCamHash({
    bytes: camBytes,
    expectedHash: camHash,
  })

  const camText = new TextDecoder().decode(camBytes)
  const cam = parseCam(JSON.parse(camText))

  return {
    host,
    camURI,
    camHash,
    camBytes,
    cam,
  }
}
