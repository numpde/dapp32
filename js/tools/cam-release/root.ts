import { getAddress, type Abi, type Address, type Hex } from "viem"
import { observeContractIdentity, type ContractIdentityReader } from "../release-provenance.ts"
import { requiredBytes32, requiredJsonRecord, requiredNonemptyString, requiredNonzeroAddress } from "../release-values.ts"
import type { OriginalContractCompilation } from "./components.ts"
import { sameAddress, sameManifest, type CamRootBaseline, type ExistingCamRoot } from "./shared.ts"

type RootReader = ContractIdentityReader & {
  readContract(request: { readonly address: Address; readonly abi: Abi; readonly functionName: string;
    readonly args?: readonly unknown[]; readonly blockNumber: bigint }): Promise<unknown>
}

/** Admit a latest publication's root independently of all component creation actors. */
export async function admitExistingCamRoot({ baseline, compilation, observationBlock, client }: {
  readonly baseline: CamRootBaseline
  readonly compilation: OriginalContractCompilation
  readonly observationBlock: { readonly number: bigint; readonly hash: Hex }
  readonly client: RootReader
}): Promise<ExistingCamRoot> {
  const address = baseline.contract.address
  const blockNumber = observationBlock.number
  const before = await client.getBlock({ blockNumber })
  if (before.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: component observation block changed before root admission`)
  const observed = await observeContractIdentity(client, baseline.contract, baseline.creator, blockNumber, "CAM root")
  if (!observed.creationInput.toLowerCase().startsWith(compilation.creationBytecode.toLowerCase())) {
    throw new Error(`Cannot admit CAM root ${address}: original creation does not match its selected source compilation`)
  }
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({
    address, abi: compilation.abi, functionName, ...(args === undefined ? {} : { args }), blockNumber,
  })
  const names = Object.keys(baseline.bindings)
  const [owner, pendingOwner, rawManifest, ...targets] = await Promise.all([
    read("owner"), read("pendingOwner"), read("camManifest"), ...names.map(name => read("contractAddress", [name])),
  ])
  const manifestFields = requiredJsonRecord(rawManifest, "observed CAM manifest")
  const manifest = { uri: requiredNonemptyString(manifestFields.uri, "observed CAM manifest URI"),
    hash: requiredBytes32(manifestFields.sha256Digest, "observed CAM manifest SHA-256") }
  if (!sameManifest(manifest, baseline.manifest)) {
    throw new Error(`Cannot admit CAM root ${address}: current manifest ${manifest.uri} ${manifest.hash} differs from latest publication ${baseline.manifest.uri} ${baseline.manifest.hash}`)
  }
  for (const [index, name] of names.entries()) {
    const target = getAddress(targets[index] as string)
    if (!sameAddress(target, baseline.bindings[name]!)) {
      throw new Error(`Cannot admit CAM root ${address}: current binding ${name}=${target} differs from latest publication ${baseline.bindings[name]}`)
    }
  }
  const after = await client.getBlock({ blockNumber })
  if (after.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: observation block changed during root admission`)
  return { ...baseline, kind: "existing", contract: observed.identity,
    owner: requiredNonzeroAddress(owner, "current CAM owner"), pendingOwner: getAddress(pendingOwner as string) }
}
