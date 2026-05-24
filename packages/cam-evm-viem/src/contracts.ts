import { resolveResourceURI } from "@cam/core"
import type { Address } from "viem"

import { camRootAbi, parseAbiBytes } from "./abi.ts"
import { CamEvmError } from "./errors.ts"
import type { ResolvedCamContract, ResolveCamContractsOptions } from "./types.ts"

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export async function resolveCamContracts({
  publicClient,
  host,
  camURI,
  cam,
  loadResource,
}: ResolveCamContractsOptions): Promise<Record<string, ResolvedCamContract>> {
  const entries = await Promise.all(
    Object.entries(cam.contracts).map(async ([name, contract]) => {
      let address: Address
      try {
        address = await publicClient.readContract({
          address: host.address,
          abi: camRootAbi,
          functionName: "contractAddress",
          args: [name],
        }) as Address
      } catch (cause) {
        throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to resolve CAM contract address: ${name}`, cause)
      }

      if (address.toLowerCase() === ZERO_ADDRESS) {
        throw new CamEvmError("CAM_CONTRACT_UNBOUND", `CAM contract is unbound: ${name}`)
      }

      const abiURI = resolveResourceURI(camURI, contract.abiURI)
      const abiBytes = await loadAbiResource(loadResource, abiURI)

      return [
        name,
        {
          name,
          address,
          abiURI,
          abi: parseAbiBytes(abiBytes, abiURI),
        },
      ] as const
    }),
  )

  return Object.fromEntries(entries)
}

async function loadAbiResource(
  loadResource: ResolveCamContractsOptions["loadResource"],
  abiURI: string,
): Promise<Uint8Array> {
  try {
    return await loadResource(abiURI)
  } catch (cause) {
    throw new CamEvmError("CAM_RESOURCE_LOAD_FAILED", `failed to load CAM ABI resource: ${abiURI}`, cause)
  }
}
