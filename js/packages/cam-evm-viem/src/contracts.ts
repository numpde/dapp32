import { resolveResourceURI } from "@cam/core"
import { createStringMap } from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import { isAddress } from "viem"

import { CAM_ROOT_FUNCTIONS, camRootAbi, parseAbiBytes } from "./abi.ts"
import { ZERO_ADDRESS } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import { loadResourceBytes } from "./resources.ts"
import type { CamHost, CamPublicClient, ResolvedCamContract, ResourceLoader } from "./types.ts"

export async function resolveCamContracts({
  publicClient,
  host,
  camURI,
  cam,
  loadResource,
}: ResolveCamContractsOptions): Promise<Record<string, ResolvedCamContract>> {
  const entries = await Promise.all(
    contractNamespaces(cam).map(async ([namespace, contractName, contract]) => [
      namespace,
      await resolveContract({
        publicClient,
        host,
        camURI,
        name: contractName,
        abiURI: contract.abiURI,
        loadResource,
      }),
    ] as const),
  )

  const contracts = createStringMap<ResolvedCamContract>()
  for (const [name, contract] of entries) {
    contracts[name] = contract
  }
  return contracts
}

function contractNamespaces(cam: CamDocument) {
  return Object.entries(cam.namespaces).flatMap(([namespace, declaration]) => {
    if (declaration.type !== "contract") {
      return []
    }

    const prefix = "contracts."
    if (!namespace.startsWith(prefix) || namespace.length === prefix.length) {
      throw new CamEvmError("CAM_CONTRACT_INVALID", `CAM contract namespace is invalid: ${namespace}`)
    }

    // Runtime maps resolved contracts by full namespace, but CamRoot stores the
    // bare onchain name because Solidity does not know the CAM namespace tree.
    return [[namespace, namespace.slice(prefix.length), declaration] as const]
  })
}

async function resolveContract({
  publicClient,
  host,
  camURI,
  name,
  abiURI: relativeAbiURI,
  loadResource,
}: {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly name: string
  readonly abiURI: string
  readonly loadResource: ResourceLoader
}): Promise<ResolvedCamContract> {
  let address: ResolvedCamContract["address"]
  try {
    address = await publicClient.readContract({
      address: host.address,
      abi: camRootAbi,
      functionName: CAM_ROOT_FUNCTIONS.contractAddress,
      args: [name],
    })
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to resolve CAM contract address: ${name}`, cause)
  }

  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new CamEvmError("CAM_CONTRACT_UNBOUND", `CAM contract is unbound: ${name}`)
  }
  if (!isAddress(address)) {
    throw new CamEvmError("CAM_CONTRACT_INVALID", `CAM contract address is invalid for ${name}: ${address}`)
  }

  const abiURI = resolveResourceURI(camURI, relativeAbiURI)
  const abiBytes = await loadResourceBytes(
    loadResource,
    abiURI,
    `failed to load CAM ABI resource: ${abiURI}`,
  )

  return {
    address,
    abi: parseAbiBytes(abiBytes, abiURI),
  }
}

type ResolveCamContractsOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly cam: CamDocument
  readonly loadResource: ResourceLoader
}
