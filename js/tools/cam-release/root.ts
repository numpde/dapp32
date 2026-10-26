import { getAddress, zeroAddress, type Abi, type Address, type Hex } from "viem"
import { observeContractIdentity, type ContractIdentityReader } from "../release-provenance.ts"
import { requiredBytes32, requiredJsonRecord, requiredNonemptyString, requiredNonzeroAddress } from "../release-values.ts"
import { camBindingRecipe } from "./bindings.ts"
import type { CamRootSelection } from "./publication.ts"
import type { OriginalContractCompilation } from "./components.ts"
import { camNominationOwner, sameAddress, sameManifest, type CamManifest, type ExistingCamRoot } from "./shared.ts"

type RootReader = ContractIdentityReader & {
  readContract(request: { readonly address: Address; readonly abi: Abi; readonly functionName: string;
    readonly args?: readonly unknown[]; readonly blockNumber: bigint }): Promise<unknown>
}

/** Admit an original root independently of component creators; require a supplied publication baseline to match live state. */
export async function admitExistingCamRoot({ selection, compilation, observationBlock, client }: {
  readonly selection: CamRootSelection
  readonly compilation: OriginalContractCompilation
  readonly observationBlock: { readonly number: bigint; readonly hash: Hex }
  readonly client: RootReader
}): Promise<ExistingCamRoot> {
  const address = selection.contract.address
  const blockNumber = observationBlock.number
  const before = await client.getBlock({ blockNumber })
  if (before.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: component observation block changed before root admission`)
  const observed = await observeContractIdentity(client, selection.contract, selection.creator, blockNumber, "CAM root")
  if (!observed.creationInput.toLowerCase().startsWith(compilation.creationBytecode.toLowerCase())) {
    throw new Error(`Cannot admit CAM root ${address}: original creation does not match its selected source compilation`)
  }
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({
    address, abi: compilation.abi, functionName, ...(args === undefined ? {} : { args }), blockNumber,
  })
  const names = camBindingRecipe(selection.app).map(step => step.args[0] as string)
  const [owner, pendingOwner, rawManifest, ...targets] = await Promise.all([
    read("owner"), read("pendingOwner"), read("camManifest"), ...names.map(name => read("contractAddress", [name])),
  ])
  const manifestFields = requiredJsonRecord(rawManifest, "observed CAM manifest")
  const manifest = { uri: requiredNonemptyString(manifestFields.uri, "observed CAM manifest URI"),
    hash: requiredBytes32(manifestFields.sha256Digest, "observed CAM manifest SHA-256") }
  if (selection.kind === "publication" && !sameManifest(manifest, selection.manifest)) {
    throw new Error(`Cannot admit CAM root ${address}: current manifest ${JSON.stringify(manifest.uri)} ${manifest.hash} differs from latest publication ${JSON.stringify(selection.manifest.uri)} ${selection.manifest.hash}`)
  }
  if (selection.kind === "attempt" && !sameManifest(manifest, selection.manifest)
      && !sameManifest(manifest, selection.attempt.plan.manifest)) {
    throw new Error(`Cannot admit CAM root ${address}: current manifest is neither the observed attempt nor its original desired manifest`)
  }
  const bindings: Record<string, Address> = {}
  for (const [index, name] of names.entries()) {
    const target = getAddress(targets[index] as string)
    bindings[name] = target
    if (selection.kind === "attempt") {
      const desired = selection.attempt.plan.bindings[index]!
      const desiredAddress = typeof desired.address === "string" ? desired.address : address
      if (!sameAddress(target, selection.bindings[name]!) && !sameAddress(target, desiredAddress)) {
        throw new Error(`Cannot admit CAM root ${address}: current binding ${name}=${target} is neither the observed attempt nor its original desired binding ${desiredAddress}`)
      }
    }
    if (selection.kind === "publication" && !sameAddress(target, selection.bindings[name]!)) {
      throw new Error(`Cannot admit CAM root ${address}: current binding ${name}=${target} differs from latest publication ${selection.bindings[name]}`)
    }
  }
  const currentOwner = requiredNonzeroAddress(owner, "current CAM owner")
  const currentPendingOwner = getAddress(pendingOwner as string)
  if (selection.kind === "attempt") {
    assertCamAuthorityProgress(address, selection.attempt.authority, camNominationOwner(selection.attempt.plan),
      { owner: currentOwner, pendingOwner: currentPendingOwner })
  }
  const after = await client.getBlock({ blockNumber })
  if (after.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: observation block changed during root admission`)
  return { kind: "existing", contract: observed.identity, sourceCommit: selection.sourceCommit, creator: selection.creator,
    origin: { kind: selection.kind, artifactSha256: selection.artifactSha256 }, bindings, manifest,
    owner: currentOwner, pendingOwner: currentPendingOwner }
}

/** Continuation may finish the retained intent; it cannot substitute components or publication choices. */
export function assertCamAttemptIntent(selection: CamRootSelection, requested: {
  readonly businessArtifactSha256: Hex
  readonly uiArtifactSha256: Hex
  readonly rootSha256: Hex
  readonly manifest: CamManifest
  readonly intendedOwner: Address
  readonly nomination: "preserve" | "nominate"
}): void {
  if (selection.kind !== "attempt") return
  const original = selection.attempt.plan
  if (requested.businessArtifactSha256.toLowerCase() !== original.businessArtifactSha256.toLowerCase()
      || requested.uiArtifactSha256.toLowerCase() !== original.uiArtifactSha256.toLowerCase()
      || requested.rootSha256.toLowerCase() !== selection.attempt.bundleRootSha256.toLowerCase()
      || !sameManifest(requested.manifest, original.manifest)
      || !sameAddress(requested.intendedOwner, original.intendedOwner) || requested.nomination !== original.nomination) {
    throw new Error("Cannot continue CAM attempt: selected components, prepared root bytes, URI/hash or intended owner differ from its original desired publication")
  }
}

/** Nomination progress may retain the observed authority or accept its intended/preserved nominee. */
export function assertCamAuthorityProgress(address: Address, before: { readonly owner: Address; readonly pendingOwner: Address },
  intendedOwner: Address, current: { readonly owner: Address; readonly pendingOwner: Address }): void {
  const handoff = !sameAddress(intendedOwner, zeroAddress) && !sameAddress(intendedOwner, before.owner)
  const acceptedIntended = handoff && sameAddress(current.owner, intendedOwner) && sameAddress(current.pendingOwner, zeroAddress)
  const acceptedPreserved = !handoff && !sameAddress(before.pendingOwner, zeroAddress)
    && sameAddress(current.owner, before.pendingOwner) && sameAddress(current.pendingOwner, zeroAddress)
  if (!sameAddress(current.owner, before.owner) && !acceptedIntended && !acceptedPreserved) {
    throw new Error(`Cannot admit CAM root ${address}: current owner is neither the observed attempt owner nor its accepted nominee`)
  }
  if (!acceptedIntended && !acceptedPreserved && !sameAddress(current.pendingOwner, before.pendingOwner)
      && (!handoff || !sameAddress(current.pendingOwner, intendedOwner))) {
    throw new Error(`Cannot admit CAM root ${address}: current pending owner is neither the observed attempt nominee nor its original intended owner`)
  }
}

export function assertCamNominationComplete(address: Address, before: { readonly owner: Address; readonly pendingOwner: Address },
  intendedOwner: Address, current: { readonly owner: Address; readonly pendingOwner: Address }): void {
  assertCamAuthorityProgress(address, before, intendedOwner, current)
  const handoff = !sameAddress(intendedOwner, zeroAddress) && !sameAddress(intendedOwner, before.owner)
  if (handoff && !(sameAddress(current.owner, before.owner) && sameAddress(current.pendingOwner, intendedOwner))
      && !(sameAddress(current.owner, intendedOwner) && sameAddress(current.pendingOwner, zeroAddress))) {
    throw new Error(`Cannot complete CAM publication ${address}: intended owner is neither nominated nor accepted`)
  }
}
