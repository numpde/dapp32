import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { createPublicClient, getAddress, http, keccak256, serializeTransaction, toHex, type Hex } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { parseReferenceSnapshot, sha256 } from "../release-approval/reference-read.ts"
import { ReleaseVerifier } from "../release-approval/verifier.ts"
import { observeContractIdentity, type ContractIdentity } from "../release-provenance.ts"
import { parseJsonRecord, requiredJsonRecord, requiredTransactionHash, runReleaseTool } from "../release-values.ts"
import { readRootCompilation } from "./compilations.ts"
import { admitCamComponents } from "./components.ts"
import { readPreparedCamBundle } from "./prepared.ts"
import { parseCamReleasePlan, sameAddress, sameManifest } from "./shared.ts"
import { camPublicationReference } from "./reference.ts"
import { parseCamPublication, type CamPublicationArtifact } from "./publication.ts"

async function main(): Promise<void> {
  const env = process.env
  const client = createPublicClient({ transport: http(requiredEnv(env, "CAM_RELEASE_RPC_URL")) })
  const candidatePath = requiredEnv(env, "CAM_RELEASE_CANDIDATE_PATH")
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_PLAN_PATH"), "CAM publication plan", 64 * 1024)
  const plan = parseCamReleasePlan(planBytes)
  if (env.CAM_RELEASE_PHASE === "verify-block") {
    const candidate = parseCamPublication(await readBoundedRegularFile(candidatePath, "CAM publication candidate", 1024 * 1024), plan.app)
    if ((await client.getBlock({ blockNumber: BigInt(candidate.verificationBlock.number) })).hash !== candidate.verificationBlock.hash) throw new Error("Cannot publish CAM artifact: its observation block changed during materialization")
    return
  }
  const reference = parseReferenceSnapshot(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_REFERENCE_PATH"), "CAM approval reference", 1024 * 1024))
  if (reference.schema !== "release-approval.cam-reference.v1" || reference.app !== plan.app || reference.sourceCommit !== plan.sourceCommit
      || reference.expectedChainId !== plan.expectedChainId || reference.planSha256 !== sha256(planBytes)) throw new Error("Cannot collect CAM publication: approval reference differs from its saved plan")
  if (await client.getChainId() !== plan.expectedChainId) throw new Error("Cannot collect CAM publication: RPC chain differs from its saved plan")
  let existing: CamPublicationArtifact | undefined
  try { existing = parseCamPublication(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_ARTIFACT_PATH"), "existing CAM publication", 1024 * 1024), plan.app) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  const blockNumber = existing === undefined ? await client.getBlockNumber() : BigInt(existing.verificationBlock.number)
  const block = await client.getBlock({ blockNumber })
  if (block.hash === null || (existing !== undefined && block.hash !== existing.verificationBlock.hash)) throw new Error("Cannot collect CAM publication: its observation block is no longer canonical")
  const prepared = await readPreparedCamBundle(requiredEnv(env, "CAM_RELEASE_PREPARED_DIR"), plan.app, plan.manifest.uri)
  if (prepared.artifactSha256.toLowerCase() !== plan.bundleArtifactSha256.toLowerCase() || prepared.rootSha256.toLowerCase() !== plan.manifest.hash.toLowerCase()) throw new Error("Cannot collect CAM publication: prepared bundle differs from its saved intent")
  const components = await admitCamComponents({ app: plan.app, businessBytes: prepared.businessBytes, uiBytes: prepared.uiBytes,
    businessCompilations: prepared.businessCompilations, uiCompilation: prepared.uiCompilation, client,
    observationBlock: { number: blockNumber, hash: block.hash } })
  const compilation = plan.root.kind === "new" ? await readRootCompilation(plan.app,
    requiredEnv(env, "CAM_RELEASE_APPROVAL_ARTIFACTS_ROOT"), requiredEnv(env, "CAM_RELEASE_EXECUTION_SOURCES_ROOT")) : prepared.rootCompilation!
  if (compilation === undefined) throw new Error("Cannot collect CAM publication: original root compilation is missing")
  const { compilerSettings: _settings, ...compiler } = compilation
  if (!isDeepStrictEqual(reference.contracts, [{ role: "camRoot", ...compiler }])) throw new Error("Cannot collect CAM publication: root compiler reference differs from its original source artifact")
  const expected = camPublicationReference(plan, reference.expectedDeployer, components, compilation.abi)
  if (!isDeepStrictEqual(expected.steps, reference.steps)) throw new Error("Cannot collect CAM publication: approved steps differ from the independent composition recipe")
  const target = plan.root.kind === "new" ? { kind: "new" as const } : { kind: "existing" as const,
    sourceCommit: plan.root.sourceCommit, creator: plan.root.creator, contract: plan.root.contract }
  if (!isDeepStrictEqual(reference.root, target)) throw new Error("Cannot collect CAM publication: admitted root target differs from the saved plan")
  const hashes: Hex[] = []
  let createdRoot: ContractIdentity | undefined
  if (reference.steps.length !== 0) {
    const broadcastPath = resolve(requiredEnv(env, "CAM_RELEASE_BROADCAST_DIR"), "PublishCam.s.sol", String(plan.expectedChainId), "run-latest.json")
    const broadcast = parseJsonRecord(await readBoundedRegularFile(broadcastPath, "CAM Forge broadcast", 16 * 1024 * 1024), "CAM Forge broadcast")
    if (!Array.isArray(broadcast.transactions) || broadcast.transactions.length !== reference.steps.length) throw new Error("Cannot collect CAM publication: mined transaction count differs from the complete approved operation; retain these records and continue the remaining CAM writes")
    const verifier = new ReleaseVerifier(reference, async hash => {
      const receipt = await client.getTransactionReceipt({ hash })
      return { transactionHash: receipt.transactionHash, status: receipt.status === "success" ? "0x1" : "0x0", contractAddress: receipt.contractAddress ?? null }
    })
    for (const row of broadcast.transactions) {
      const hash = requiredTransactionHash(requiredJsonRecord(row, "CAM broadcast transaction").hash, "CAM transaction hash")
      const [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })])
      if (receipt.blockNumber > blockNumber) throw new Error(`Cannot collect CAM transaction ${hash}: receipt is later than observation block ${blockNumber}`)
      if (transaction.type !== "eip1559") throw new Error(`Cannot collect CAM transaction ${hash}: signed type-2 transaction required`)
      const raw = serializeTransaction({ ...transaction, data: transaction.input }, { r: transaction.r, s: transaction.s, yParity: transaction.yParity })
      const review = await verifier.inspect(raw)
      if (review.signed.hash !== hash || receipt.transactionHash !== hash || receipt.status !== "success"
          || getAddress(receipt.from) !== getAddress(reference.expectedDeployer)
          || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error(`Cannot collect CAM transaction ${hash}: signed bytes or successful canonical receipt differ`)
      verifier.accepted(hash)
      hashes.push(hash)
      if (review.step.kind === "create") {
        if (receipt.contractAddress == null || getAddress(receipt.contractAddress) !== getAddress(review.comparison.predictedAddress!)) throw new Error("Cannot collect CAM creation: receipt address differs from the approved creation")
        const address = getAddress(receipt.contractAddress)
        const code = await client.getCode({ address, blockNumber })
        if (code === undefined || code === "0x") throw new Error(`Cannot collect CAM root ${address}: no runtime at its observation block`)
        createdRoot = { address, codeHash: keccak256(code), creationTransaction: hash, creationInputHash: keccak256(transaction.input) }
      }
    }
  }
  const identity = plan.root.kind === "new" ? createdRoot : plan.root.contract
  if (identity === undefined) throw new Error("Cannot collect CAM publication: no verified root creation is present")
  const creator = plan.root.kind === "new" ? reference.expectedDeployer : plan.root.creator
  const observedRoot = await observeContractIdentity(client, identity, creator, blockNumber, "published CAM root")
  if (!observedRoot.creationInput.toLowerCase().startsWith(compilation.creationBytecode.toLowerCase())) throw new Error("Cannot collect CAM publication: original root program differs from its selected source")
  const address = identity.address
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({ address, abi: compilation.abi,
    functionName, ...(args === undefined ? {} : { args }), blockNumber })
  const bindings: Record<string, `0x${string}`> = {}
  for (const binding of plan.bindings) {
    const expectedAddress = typeof binding.address === "string" ? binding.address : address
    const actual = getAddress(await read("contractAddress", [binding.name]) as string)
    if (!sameAddress(actual, expectedAddress)) throw new Error(`Cannot collect CAM root ${address}: binding ${binding.name}=${actual} differs from desired ${expectedAddress}`)
    bindings[binding.name] = actual
  }
  const manifest = await read("camManifest") as { uri: string; sha256Digest: Hex }
  if (!sameManifest({ uri: manifest.uri, hash: manifest.sha256Digest }, plan.manifest)) throw new Error(`Cannot collect CAM root ${address}: current manifest differs from the composed URI/hash`)
  const authority = { owner: getAddress(await read("owner") as string), pendingOwner: getAddress(await read("pendingOwner") as string) }
  if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error("Cannot collect CAM publication: its canonical observation block changed while reading receipts or state")
  const candidate = parseCamPublication(new TextEncoder().encode(JSON.stringify({ schema: "cam.publication.v1", app: plan.app,
    sourceCommit: plan.sourceCommit, chainId: plan.expectedChainId, signer: reference.expectedDeployer,
    planSha256: reference.planSha256, referenceSha256: reference.snapshotSha256,
    businessArtifactSha256: plan.businessArtifactSha256, uiArtifactSha256: plan.uiArtifactSha256, bundleArtifactSha256: plan.bundleArtifactSha256,
    root: { sourceCommit: plan.root.kind === "new" ? plan.sourceCommit : plan.root.sourceCommit, creator, contract: observedRoot.identity },
    bindings, manifest: plan.manifest, authority, transactions: hashes, verificationBlock: { number: toHex(blockNumber), hash: block.hash },
    predecessor: plan.root.kind === "new" ? null : plan.root.origin })), plan.app)
  await writeNewJson(candidatePath, candidate, "CAM publication candidate")
  process.stdout.write(`${JSON.stringify({ event: "cam_publication_observed", app: plan.app, root: address, authority, verificationBlock: candidate.verificationBlock })}\n`)
}

runReleaseTool(main)
