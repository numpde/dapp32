import { encodeDeployData, getAddress, keccak256, type Abi, type Hex } from "viem"
import { businessFromDeployment } from "../contract-release/shared.ts"
import { observeContractIdentity, type ContractIdentity, type ContractIdentityReader } from "../release-provenance.ts"
import { sha256, type ReleaseApp } from "../release-approval/reference-read.ts"
import { parseUIDeploymentArtifact, uiCreationStep } from "../ui-release/shared.ts"

export type OriginalContractCompilation = { readonly abi: Abi; readonly creationBytecode: Hex }
type ComponentReader = ContractIdentityReader & { getChainId(): Promise<number>; getBlockNumber(): Promise<bigint> }

export async function admitCamComponents({ app, businessBytes, uiBytes, businessCompilations, uiCompilation, client }: {
  readonly app: ReleaseApp
  readonly businessBytes: Uint8Array
  readonly uiBytes: Uint8Array
  readonly businessCompilations: Readonly<Record<string, OriginalContractCompilation>>
  readonly uiCompilation: OriginalContractCompilation
  readonly client: ComponentReader
}) {
  const business = businessFromDeployment(app, businessBytes)
  const ui = parseUIDeploymentArtifact(uiBytes, app)
  const backingRole = app === "bike-nft" ? "manager" : app === "escrow" ? "escrow" : "payments"
  const backing = business.contracts[backingRole]!
  if (ui.chainId !== business.chainId || ui.backing.artifactSha256 !== business.artifactSha256
      || ui.backing.sourceCommit !== business.sourceCommit || getAddress(ui.backing.creator) !== getAddress(business.creator)
      || getAddress(ui.backing.address) !== getAddress(backing.address) || ui.backing.codeHash.toLowerCase() !== backing.codeHash.toLowerCase()
      || ui.backing.creationTransaction.toLowerCase() !== backing.creationTransaction.toLowerCase()) {
    throw new Error("Cannot compose CAM: the selected UI artifact names a different business deployment")
  }
  if (await client.getChainId() !== business.chainId) throw new Error("Cannot compose CAM: RPC chain differs from the selected component artifacts")
  const blockNumber = await client.getBlockNumber()
  const block = await client.getBlock({ blockNumber })
  const contracts: Record<string, ContractIdentity> = {}
  for (const [role, identity] of Object.entries(business.contracts)) {
    const observed = await observeContractIdentity(client, identity, business.creator, blockNumber, `${app} ${role}`)
    const compiled = businessCompilations[role]
    if (compiled === undefined || !observed.creationInput.toLowerCase().startsWith(compiled.creationBytecode.toLowerCase())) {
      throw new Error(`Cannot compose CAM: the original ${role} creation does not match its selected source compilation`)
    }
    contracts[role] = observed.identity
  }
  const observedUI = await observeContractIdentity(client, ui.ui, ui.creator, blockNumber, `${app} UI`)
  if (ui.backing.creationInputHash.toLowerCase() !== contracts[backingRole]!.creationInputHash.toLowerCase()) {
    throw new Error(`Cannot compose CAM: the UI backing input hash ${ui.backing.creationInputHash} differs from original creation ${contracts[backingRole]!.creationInputHash}`)
  }
  const creation = uiCreationStep(app, contracts[backingRole]!.address)
  const expectedInput = encodeDeployData({ abi: uiCompilation.abi, bytecode: uiCompilation.creationBytecode, args: creation.args })
  const expectedInputHash = keccak256(expectedInput)
  if (expectedInputHash !== observedUI.identity.creationInputHash) {
    throw new Error(`Cannot compose CAM: UI ${ui.ui.address} creation input hash ${observedUI.identity.creationInputHash} differs from source-and-backing hash ${expectedInputHash} for ${backing.address}`)
  }
  if (block.hash === null || (await client.getBlock({ blockNumber })).hash !== block.hash) {
    throw new Error("Cannot compose CAM: its component observation block changed during admission")
  }
  return { app, chainId: business.chainId, business: { sourceCommit: business.sourceCommit, creator: business.creator,
    artifactSha256: business.artifactSha256, contracts }, ui: { sourceCommit: ui.sourceCommit, creator: ui.creator,
    artifactSha256: sha256(uiBytes), contract: observedUI.identity, backing: backingRole }, observationBlock: { number: blockNumber, hash: block.hash } }
}
