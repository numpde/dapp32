// Deterministic supplement to the generic single-account random walker. This
// executable is ONLY wired into the disposable Bike local write fixture.
import { pathToFileURL } from "node:url"
import { BaseError, ContractFunctionRevertedError, createPublicClient, http } from "viem"
import type { Address, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient, simulateCamContractCall } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import type { CamViewerPreparedContractCall } from "../../packages/cam-viewer/dist/index.js"
import { resolvedUiButtons } from "../../packages/cam-screen/dist/index.js"
import { createSameOriginHttpResourceLoader, isRecordObject } from "../../packages/cam-protocol/dist/index.js"
import type { InertRecord, InertValue } from "../../packages/cam-protocol/dist/index.js"
import { readOptions } from "./options.ts"
import { createWriteContext, handlePreparedWrite } from "./writes.ts"
import { assertResolvedSnapshot, requireLoadedSnapshot } from "./snapshots.ts"
import { emit, errorMessage } from "./events.ts"

const COMPONENT_WRITES = ["updateComponentMetadata", "markComponentMissing", "clearComponentMissing", "decommissionComponent", "reactivateComponent", "transferComponent", "setComponentDelegate", "revokeComponentDelegate"]

export function assertBikeActorFixture(chainId: string, rpcUrl: string, actors: readonly Address[]): void {
  // Exact service origin, no credentials, path, query, or fragment. Checking a
  // development chain ID alone is not permission to fund arbitrary endpoints.
  if (chainId !== "eip155:31337" || !["http://bike-nft-anvil:8545", "http://bike-nft-anvil:8545/"].includes(rpcUrl)) {
    throw new Error("actor campaign only runs on the private Bike fixture")
  }
  if (actors.length !== 3 || new Set(actors.map(actor => actor.toLowerCase())).size !== 3) {
    throw new Error("actor campaign requires three distinct signing accounts")
  }
}

export function assertBikeAuthority(values: readonly InertValue[], owner: Address, authority: "owner" | "delegate" | "none"): void {
  const view = values[0]
  if (!isRecordObject(view) || typeof view.owner !== "string" || view.owner.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Bike actor campaign: unexpected component owner")
  }
  if (view.authorityId !== authority) throw new Error("Bike actor campaign: unexpected component authority")
  if (view.delegationActive !== (authority === "delegate")) throw new Error("Bike actor campaign: unexpected delegation activity")
  const actions = view.actions
  if (!Array.isArray(actions)) throw new Error("Bike actor campaign: missing actions")
  if (authority === "none" && COMPONENT_WRITES.some(action => actions.includes(action))) {
    throw new Error("Bike actor campaign: stale write authority after handover")
  }
  if (authority !== "none" && !actions.includes("updateComponentMetadata")) {
    throw new Error("Bike actor campaign: missing metadata authority")
  }
  if (authority === "owner" && !actions.includes("transferComponent")) {
    throw new Error("Bike actor campaign: missing handover authority")
  }
}

export function isUnauthorizedRevert(error: unknown): boolean {
  if (!(error instanceof Error) || !(error.cause instanceof BaseError)) return false
  const reverted = error.cause.walk(cause => cause instanceof ContractFunctionRevertedError)
  return reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === "Unauthorized"
}

async function main(): Promise<void> {
  const options = readOptions(process.env)
  if (options.writeMode.kind !== "local-fixture") throw new Error("actor campaign requires local-fixture writes")
  const seller = options.descriptor.accounts[0]
  if (seller === undefined) throw new Error("missing seller account")
  function fixtureKey(name: string): Hex {
    const value = process.env[name]
    if (value === undefined || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name}: expected fixture signing key`)
    return value as Hex
  }
  const buyerKey = fixtureKey("BIKE_FIXTURE_BUYER_PRIVATE_KEY")
  const mechanicKey = fixtureKey("BIKE_FIXTURE_MECHANIC_PRIVATE_KEY")
  const buyer = privateKeyToAccount(buyerKey).address
  const mechanic = privateKeyToAccount(mechanicKey).address
  assertBikeActorFixture(options.descriptor.chainId, options.descriptor.rpcUrl, [seller, buyer, mechanic])
  const contexts = new Map([
    [seller, createWriteContext(options, seller)],
    [buyer, createWriteContext({ ...options, writeMode: { kind: "local-fixture", privateKey: buyerKey } }, buyer)],
    [mechanic, createWriteContext({ ...options, writeMode: { kind: "local-fixture", privateKey: mechanicKey } }, mechanic)],
  ])
  const transport = http(options.descriptor.rpcUrl)
  const client = createPublicClient({ transport })
  if (await client.getChainId() !== 31337) throw new Error("Bike fixture RPC chain mismatch")
  const code = await client.getCode({ address: options.descriptor.camHost })
  if (code === undefined || code === "0x") throw new Error("Bike fixture CAM host has no code")
  // Only after locality, signer, RPC chain, and host checks: fund the two
  // additional deliberately public fixture signers on the disposable chain.
  const rpc = transport({})
  for (const actor of [buyer, mechanic]) {
    await rpc.request({ method: "anvil_setBalance", params: [actor, "0x3635C9ADC5DEA00000"] })
  }
  const session = createCamViewerSession({
    publicClient: createHttpCamPublicClient({ rpcURL: options.descriptor.rpcUrl }),
    host: { chainId: options.descriptor.chainId, address: options.descriptor.camHost },
    account: { address: seller },
    inputs: {},
    loadResource: createSameOriginHttpResourceLoader({ originInput: options.descriptor.resourceOrigin, originLabel: "descriptor.resourceOrigin", fetchResource: fetch, loadFailurePrefix: "failed to load CAM resource" }),
  })
  let actor = seller
  let step = 0
  async function select(next: Address): Promise<void> {
    actor = next
    assertResolvedSnapshot(await session.setAccount({ address: next }))
    emit({ event: "bike_actor_selected", account: next })
  }
  async function dispatch(route: string, patch: InertRecord = {}, capabilities?: string): Promise<CamViewerPreparedContractCall | undefined> {
    const snapshot = session.updateState(patch)
    assertResolvedSnapshot(snapshot)
    const buttons = resolvedUiButtons(snapshot.resolvedUi).filter(button => button.disabled !== true && button.call.function === route && (capabilities === undefined || button.call.args.capabilities === capabilities))
    if (buttons.length !== 1) throw new Error(`Bike actor campaign expected one enabled button: ${route}`)
    const result = await session.dispatchAction(buttons[0]!)
    if (result.type === "navigated") {
      assertResolvedSnapshot(result.snapshot)
      return undefined
    }
    const writeContext = contexts.get(actor)
    if (writeContext === undefined) throw new Error("unknown fixture signer")
    await handlePreparedWrite({ publicClient: client, receiptClient: client, account: actor, run: -1, step: step++, session, writeContext, call: result.call })
    return result.call
  }
  function authority(owner: Address, expected: "owner" | "delegate" | "none"): void {
    const snapshot = requireLoadedSnapshot(session.snapshot())
    assertBikeAuthority(snapshot.values, owner, expected)
    if (expected === "none" && resolvedUiButtons(snapshot.resolvedUi).some(button => button.disabled !== true && COMPONENT_WRITES.includes(button.call.function))) {
      throw new Error("Bike actor campaign: rendered write enabled after authority loss")
    }
  }
  async function rejectStaleMetadata(account: Address, call: CamViewerPreparedContractCall): Promise<void> {
    try {
      await simulateCamContractCall({ publicClient: client, account, call })
    } catch (error) {
      if (!isUnauthorizedRevert(error)) throw error
      emit({ event: "bike_actor_authority_rejected", account, route: call.route, expectedError: "Unauthorized" })
      return
    }
    throw new Error("Bike actor campaign: old authority still accepted after handover")
  }

  emit({ event: "bike_actor_start", seller, buyer, mechanic })
  assertResolvedSnapshot(await session.load())
  // Dedicated serial keeps the random walk's finite value corpus independent.
  const serialNumber = "CAM-BIKE-DISTINCT-ACTOR-SCENARIO"
  await dispatch("register", { serialNumber })
  await dispatch("registerComponent", { owner: seller, serialNumber, tokenURI: "ipfs://fixture-seller" })
  authority(seller, "owner")
  const sellerMetadata = await dispatch("updateComponentMetadata", { tokenURI: "ipfs://fixture-seller-updated" })
  await dispatch("delegation", { delegate: mechanic, duration: "3600" })
  await dispatch("setComponentDelegate", {}, "7")
  await select(mechanic)
  authority(seller, "delegate")
  const mechanicMetadata = await dispatch("updateComponentMetadata", { tokenURI: "ipfs://fixture-workshop" })
  await select(seller)
  await dispatch("transferComponent", { to: buyer })
  authority(buyer, "none")
  if (sellerMetadata === undefined || mechanicMetadata === undefined) throw new Error("metadata write was not prepared")
  await rejectStaleMetadata(seller, sellerMetadata)
  await select(mechanic)
  authority(buyer, "none")
  await rejectStaleMetadata(mechanic, mechanicMetadata)
  await select(buyer)
  authority(buyer, "owner")
  await dispatch("updateComponentMetadata", { tokenURI: "ipfs://fixture-buyer" })
  authority(buyer, "owner")
  emit({ event: "bike_actor_ok", seller, buyer, mechanic, serialNumber, owner: buyer })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    emit({ event: "error", error: errorMessage(error) })
    process.exitCode = 1
  })
}
