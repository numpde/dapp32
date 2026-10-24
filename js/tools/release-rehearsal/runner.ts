import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, sha256 } from "viem"
import type { Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import { createCamResourceLoader } from "../../packages/cam-protocol/dist/index.js"
import { parseReleasePlan as parseEscrowPlan, parseDeploymentArtifact as parseEscrow } from "../escrow-release/shared.ts"
import { parseReleasePlan as parsePaymentsPlan, parseDeploymentArtifact as parsePayments } from "../pay-to-play-release/shared.ts"
import { parseReleasePlan as parseBikePlan, parseDeploymentArtifact as parseBike } from "../bike-nft-release/shared.ts"
import { requiredEnv } from "../input.ts"
import { runReleaseTool } from "../release-values.ts"
import { camOrigin, chainId, deployerKey, owners, rehearsalApp, releaseInputs, rpcURL, shellAssignments } from "./fixture.ts"

const ABI = parseAbi([
  "function acceptOwnership()",
  "function acceptDefaultAdminTransfer()",
  "function pendingDefaultAdmin() view returns (address newAdmin, uint48 acceptSchedule)",
  "error AccessControlEnforcedDefaultAdminDelay(uint48 schedule)",
  "function camManifest() view returns ((string uri, bytes32 sha256Digest))",
])

async function main(): Promise<void> {
  const app = rehearsalApp(requiredEnv(process.env, "REHEARSAL_DAPP"))
  const chain = {
    id: chainId, name: "Isolated release rehearsal",
    nativeCurrency: { name: "Fixture Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcURL] } },
  }
  const client = createPublicClient({ chain, transport: http(rpcURL) })
  const fixture = createTestClient({ mode: "anvil", chain, transport: http(rpcURL) })
  assert.equal(await client.getChainId(), chainId)
  const action = process.argv[2]
  if (action === "fund") {
    await fixture.setBalance({ address: privateKeyToAccount(deployerKey).address, value: 1000n * 10n ** 18n })
    return
  }
  if (action === "prepare") {
    for (const account of [privateKeyToAccount(deployerKey), ...Object.values(owners)]) {
      await fixture.setBalance({ address: account.address, value: 1000n * 10n ** 18n })
    }
    const directory = requiredEnv(process.env, "RELEASE_REHEARSAL_HOST_DIR")
    await writeFile("/rehearsal-control/inputs.env", shellAssignments(releaseInputs(app, directory)), { flag: "wx", mode: 0o600 })
    await writeFile("/rehearsal-control/rpc-url", rpcURL + "\n", { flag: "wx", mode: 0o600 })
    await writeFile("/rehearsal-control/deployer-key", deployerKey + "\n", { flag: "wx", mode: 0o600 })
    return
  }
  if (action !== "accept") throw new Error("Rehearsal action must be prepare, fund or accept")
  const bytes = await readFile("/deployment/deployment.json")
  const planBytes = await readFile("/deployment/release-plan.json")
  let root: Address
  let camHash: `0x${string}`
  if (app === "pay-to-play") {
    const artifact = parsePayments(bytes)
    assertPlannedDeployment(parsePaymentsPlan(planBytes), artifact)
    root = artifact.camRoot
    camHash = artifact.camHash
    await accept(artifact.camRoot, owners.root, "acceptOwnership")
    await accept(artifact.payToPlay, owners.payment, "acceptOwnership")
  } else if (app === "escrow") {
    const artifact = parseEscrow(bytes)
    assertPlannedDeployment(parseEscrowPlan(planBytes), artifact)
    root = artifact.camRoot
    camHash = artifact.camHash
    await accept(artifact.camRoot, owners.root, "acceptOwnership")
  } else {
    const artifact = parseBike(bytes)
    assertPlannedDeployment(parseBikePlan(planBytes), artifact)
    root = artifact.camRoot
    camHash = artifact.camHash
    const schedules = await Promise.all([
      requireAdminWait(artifact.components, owners.payment),
      requireAdminWait(artifact.manager, owners.manager),
    ])
    const block = await client.getBlock()
    await fixture.increaseTime({ seconds: Math.max(...schedules) - Number(block.timestamp) + 1 })
    await fixture.mine({ blocks: 1 })
    await accept(artifact.camRoot, owners.root, "acceptOwnership")
    await accept(artifact.components, owners.payment, "acceptDefaultAdminTransfer")
    await accept(artifact.manager, owners.manager, "acceptDefaultAdminTransfer")
  }
  const manifest = await client.readContract({ address: root, abi: ABI, functionName: "camManifest" })
  assert.equal(manifest.uri, `${camOrigin}/${app}/main.json`)
  assert.equal(manifest.sha256Digest, camHash)
  const fetched = await fetch(manifest.uri, { signal: AbortSignal.timeout(10000) })
  assert.equal(fetched.status, 200)
  assert.equal(sha256(new Uint8Array(await fetched.arrayBuffer())), sha256(await readFile("/deployment/source-main.json")))
  const session = createCamViewerSession({
    publicClient: createHttpCamPublicClient({ rpcURL }),
    host: { chainId: `eip155:${chainId}`, address: root },
    account: { address: owners.root.address },
    inputs: {},
    loadResource: createCamResourceLoader({
      originInput: camOrigin, originLabel: "rehearsal CAM origin", fetchResource: fetch,
      loadFailurePrefix: "Cannot load rehearsal CAM resource",
    }),
  })
  await session.load()
  assert.ok(session.snapshot().resolvedUi, "Published fixture CAM must discover bindings and render its entry route")
  process.stdout.write(`${JSON.stringify({ event: "release_rehearsal_handoffs_and_discovery", app, camRoot: root, camURI: manifest.uri })}\n`)

  async function accept(address: Address, account: typeof owners.root, functionName: "acceptOwnership" | "acceptDefaultAdminTransfer"): Promise<void> {
    const wallet = createWalletClient({ chain, account, transport: http(rpcURL) })
    const hash = await wallet.writeContract({ address, abi: ABI, functionName })
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 20000 })
    assert.equal(receipt.status, "success", `${functionName} must succeed at ${address}`)
  }

  async function requireAdminWait(address: Address, account: typeof owners.root): Promise<number> {
    const [pending, schedule] = await client.readContract({ address, abi: ABI, functionName: "pendingDefaultAdmin" })
    assert.equal(pending.toLowerCase(), account.address.toLowerCase())
    assert.ok((await client.getBlock()).timestamp < BigInt(schedule), "Admin handoff must still be waiting")
    await assert.rejects(
      () => client.simulateContract({ account, address, abi: ABI, functionName: "acceptDefaultAdminTransfer" }),
      /AccessControlEnforcedDefaultAdminDelay/,
    )
    return schedule
  }
}

runReleaseTool(main)

function assertPlannedDeployment(plan: Readonly<Record<string, unknown>>, artifact: Readonly<Record<string, unknown>>): void {
  for (const [field, value] of Object.entries(plan)) {
    if (field === "schema") continue
    const artifactField = field === "expectedChainId" ? "chainId" : field
    assert.deepEqual(artifact[artifactField], value, `Deployment must preserve planned ${field}`)
  }
}
