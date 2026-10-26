import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { createPublicClient, createTestClient, createWalletClient, http, parseAbi, sha256 } from "viem"
import type { Address } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { createHttpCamPublicClient } from "../../packages/cam-evm-viem/dist/index.js"
import { createCamViewerSession } from "../../packages/cam-viewer/dist/index.js"
import { createCamResourceLoader } from "../../packages/cam-protocol/dist/index.js"
import { parseContractDeployment } from "../contract-release/shared.ts"
import { parseUIDeploymentArtifact } from "../ui-release/shared.ts"
import { parseCamPublication } from "../cam-release/publication.ts"
import { parseCamReleasePlan } from "../cam-release/shared.ts"
import { requiredEnv } from "../input.ts"
import { runReleaseTool } from "../release-values.ts"
import { camOrigin, chainId, deployerKey, owners, rehearsalApp, rehearsalConfiguration, releaseInputs, rpcURL, shellAssignments } from "./fixture.ts"

const ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function defaultAdmin() view returns (address)",
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
  if (action === "configure") {
    const config = rehearsalConfiguration(app, requiredEnv(process.env, "RELEASE_REHEARSAL_HOST_DIR"),
      requiredEnv(process.env, "REHEARSAL_SOURCE_COMMIT"), requiredEnv(process.env, "RELEASE_APPROVAL_IMAGE"),
      requiredEnv(process.env, "RELEASE_REHEARSAL_NETWORK"))
    await writeFile("/rehearsal-control/release.json", JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    return
  }
  if (action === "host") {
    const directory = requiredEnv(process.env, "RELEASE_REHEARSAL_HOST_DIR")
    const path = "/rehearsal-control/release.json"
    const config = JSON.parse(await readFile(path, "utf8")) as { settings: Record<string, string> }
    config.settings.CAM_URI = `${camOrigin}/${app}/main.json`
    await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 })
    const overlay = { services: { "release-cam": {
      user: "${LOCAL_UID:?missing_LOCAL_UID}:${LOCAL_GID:?missing_LOCAL_GID}",
      volumes: [{ type: "bind", source: `${directory}/deployment/cam-bundle/bundle`,
        target: `/tmp/${app}`, read_only: true, bind: { create_host_path: false } }],
      healthcheck: { test: ["CMD", "python3", "-c", `import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/${app}/main.json', timeout=2).close()`] },
    } } }
    await writeFile("/rehearsal-control/cam-host.json", JSON.stringify(overlay) + "\n", { flag: "wx", mode: 0o600 })
    return
  }
  if (action !== "accept") throw new Error("Rehearsal action must be prepare, configure, host, fund or accept")
  const businessBytes = await readFile("/deployment/business.json")
  const uiBytes = await readFile("/deployment/ui.json")
  const business = parseContractDeployment(businessBytes, app)
  const ui = parseUIDeploymentArtifact(uiBytes, app)
  const publication = parseCamPublication(await readFile("/deployment/cam.json"), app)
  const planBytes = await readFile("/deployment/cam-plan.json")
  const plan = parseCamReleasePlan(planBytes)
  assert.equal(publication.planSha256, sha256(planBytes))
  assert.equal(publication.businessArtifactSha256, sha256(businessBytes))
  assert.equal(publication.uiArtifactSha256, sha256(uiBytes))
  assert.equal(ui.backing.artifactSha256, sha256(businessBytes))
  const root = publication.root.contract.address
  const camHash = publication.manifest.hash
  assert.equal(publication.authority.owner.toLowerCase(), privateKeyToAccount(deployerKey).address.toLowerCase())
  assert.equal(publication.authority.pendingOwner.toLowerCase(), owners.root.address.toLowerCase())
  assert.equal((await client.readContract({ address: root, abi: ABI, functionName: "pendingOwner" })).toLowerCase(), owners.root.address.toLowerCase())
  if (business.app === "pay-to-play") {
    assert.equal(business.administration.payments.pendingOwner.toLowerCase(), owners.payment.address.toLowerCase())
    await accept(business.contracts.payments!.address, owners.payment, "acceptOwnership")
    assert.equal((await client.readContract({ address: business.contracts.payments!.address, abi: ABI, functionName: "owner" })).toLowerCase(), owners.payment.address.toLowerCase())
  } else if (business.app === "bike-nft") {
    assert.equal(business.administration.components.pendingAdmin.toLowerCase(), owners.payment.address.toLowerCase())
    assert.equal(business.administration.manager.pendingAdmin.toLowerCase(), owners.manager.address.toLowerCase())
    const schedules = await Promise.all([
      requireAdminWait(business.contracts.components!.address, owners.payment),
      requireAdminWait(business.contracts.manager!.address, owners.manager),
    ])
    const block = await client.getBlock()
    await fixture.increaseTime({ seconds: Math.max(...schedules) - Number(block.timestamp) + 1 })
    await fixture.mine({ blocks: 1 })
    await accept(business.contracts.components!.address, owners.payment, "acceptDefaultAdminTransfer")
    await accept(business.contracts.manager!.address, owners.manager, "acceptDefaultAdminTransfer")
    assert.equal((await client.readContract({ address: business.contracts.components!.address, abi: ABI, functionName: "defaultAdmin" })).toLowerCase(), owners.payment.address.toLowerCase())
    assert.equal((await client.readContract({ address: business.contracts.manager!.address, abi: ABI, functionName: "defaultAdmin" })).toLowerCase(), owners.manager.address.toLowerCase())
  }
  await accept(root, owners.root, "acceptOwnership")
  assert.equal((await client.readContract({ address: root, abi: ABI, functionName: "owner" })).toLowerCase(), owners.root.address.toLowerCase())
  assert.equal(publication.manifest.uri, plan.manifest.uri)
  const manifest = await client.readContract({ address: root, abi: ABI, functionName: "camManifest" })
  assert.equal(manifest.uri, `${camOrigin}/${app}/main.json`)
  assert.equal(manifest.sha256Digest, camHash)
  const fetched = await fetch(manifest.uri, { signal: AbortSignal.timeout(10000) })
  assert.equal(fetched.status, 200)
  assert.equal(sha256(new Uint8Array(await fetched.arrayBuffer())), sha256(await readFile("/deployment/bundle/main.json")))
  assert.equal(camHash, sha256(await readFile("/deployment/bundle/main.json")))
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
