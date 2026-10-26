import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { createPublicClient, getAddress, http, keccak256, serializeTransaction, toHex, zeroAddress, zeroHash, type Hex } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { parseReferenceSnapshot, sha256 } from "../release-approval/reference-read.ts"
import { ReleaseVerifier } from "../release-approval/verifier.ts"
import { observeContractIdentity, type ContractIdentity } from "../release-provenance.ts"
import { parseJsonRecord, requiredTransactionHash, runReleaseTool } from "../release-values.ts"
import { readOriginalRootCompilation, readRootCompilation } from "./compilations.ts"
import { admitCamComponents } from "./components.ts"
import { readPreparedCamBundle } from "./prepared.ts"
import { camNominationOwner, parseCamReleasePlan, sameAddress, sameManifest } from "./shared.ts"
import { assertCamAttemptIntent, assertCamAuthorityProgress, assertCamNominationComplete } from "./root.ts"
import { camPublicationReference } from "./reference.ts"
import { parseCamPublication, parseCamAttempt, rootFromArtifact, type CamPublicationArtifact, type CamPublicationAttempt } from "./publication.ts"

async function main(): Promise<void> {
  const env = process.env
  const client = createPublicClient({ transport: http(requiredEnv(env, "CAM_RELEASE_RPC_URL")) })
  const candidatePath = requiredEnv(env, "CAM_RELEASE_CANDIDATE_PATH")
  const planBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_PLAN_PATH"), "CAM publication plan", 64 * 1024)
  const plan = parseCamReleasePlan(planBytes)
  if (env.CAM_RELEASE_PHASE === "verify-block") {
    const bytes = await readBoundedRegularFile(candidatePath, "CAM publication candidate", 1024 * 1024)
    const candidate = parseJsonRecord(bytes, "CAM candidate").schema === "cam.publication-attempt.v1" ? parseCamAttempt(bytes, plan.app) : parseCamPublication(bytes, plan.app)
    if ((await client.getBlock({ blockNumber: BigInt(candidate.verificationBlock.number) })).hash !== candidate.verificationBlock.hash) throw new Error("Cannot publish CAM artifact: its observation block changed during materialization")
    return
  }
  const reference = parseReferenceSnapshot(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_REFERENCE_PATH"), "CAM approval reference", 1024 * 1024))
  if (reference.schema !== "release-approval.cam-reference.v1" || reference.app !== plan.app || reference.sourceCommit !== plan.sourceCommit
      || reference.expectedChainId !== plan.expectedChainId || reference.planSha256 !== sha256(planBytes)) throw new Error("Cannot collect CAM publication: approval reference differs from its saved plan")
  if (await client.getChainId() !== plan.expectedChainId) throw new Error("Cannot collect CAM publication: RPC chain differs from its saved plan")
  let existing: CamPublicationArtifact | CamPublicationAttempt | undefined
  try { existing = parseCamPublication(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_ARTIFACT_PATH"), "existing CAM publication", 1024 * 1024), plan.app) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  if (existing === undefined) {
    try { existing = parseCamAttempt(await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_ATTEMPT_PATH"), "existing CAM attempt", 1024 * 1024), plan.app) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }
  const blockNumber = existing === undefined ? await client.getBlockNumber() : BigInt(existing.verificationBlock.number)
  const block = await client.getBlock({ blockNumber })
  if (block.hash === null || (existing !== undefined && block.hash !== existing.verificationBlock.hash)) throw new Error("Cannot collect CAM publication: its observation block is no longer canonical")
  const prepared = await readPreparedCamBundle(requiredEnv(env, "CAM_RELEASE_PREPARED_DIR"), plan.app, plan.manifest.uri)
  if (prepared.artifactSha256.toLowerCase() !== plan.bundleArtifactSha256.toLowerCase() || (plan.manifest.hash.toLowerCase() !== zeroHash && prepared.rootSha256.toLowerCase() !== plan.manifest.hash.toLowerCase())) throw new Error("Cannot collect CAM publication: prepared bundle differs from its saved intent")
  if (plan.root.kind === "existing") {
    const origin = rootFromArtifact(plan.app, await readBoundedRegularFile("/root-proof/root.json", "retained original root evidence", 1024 * 1024))
    if (origin.kind !== plan.root.origin.kind || origin.artifactSha256.toLowerCase() !== plan.root.origin.artifactSha256.toLowerCase()
        || origin.chainId !== plan.expectedChainId || origin.sourceCommit !== plan.root.sourceCommit
        || !sameAddress(origin.creator, plan.root.creator) || !sameAddress(origin.contract.address, plan.root.contract.address)
        || origin.contract.creationTransaction.toLowerCase() !== plan.root.contract.creationTransaction.toLowerCase()
        || origin.contract.codeHash.toLowerCase() !== plan.root.contract.codeHash.toLowerCase()
        || (origin.contract.creationInputHash !== undefined && origin.contract.creationInputHash.toLowerCase() !== plan.root.contract.creationInputHash.toLowerCase())) {
      throw new Error("Cannot collect CAM publication: retained original root evidence differs from its admitted plan")
    }
    assertCamAttemptIntent(origin, { businessArtifactSha256: plan.businessArtifactSha256,
      uiArtifactSha256: plan.uiArtifactSha256, rootSha256: prepared.rootSha256, manifest: plan.manifest, intendedOwner: plan.intendedOwner, nomination: plan.nomination })
  }
  const components = await admitCamComponents({ app: plan.app, businessBytes: prepared.businessBytes, uiBytes: prepared.uiBytes,
    businessCompilations: prepared.businessCompilations, uiCompilation: prepared.uiCompilation, client,
    observationBlock: { number: blockNumber, hash: block.hash } })
  const compilation = plan.root.kind === "new" ? await readRootCompilation(plan.app,
    requiredEnv(env, "CAM_RELEASE_APPROVAL_ARTIFACTS_ROOT"), requiredEnv(env, "CAM_RELEASE_EXECUTION_SOURCES_ROOT")) : await readOriginalRootCompilation(plan.app, plan.root.sourceCommit)
  if (compilation === undefined) throw new Error("Cannot collect CAM publication: original root compilation is missing")
  const { compilerSettings: _settings, ...compiler } = compilation
  if (!isDeepStrictEqual(reference.contracts, [{ role: "camRoot", ...compiler }])) throw new Error("Cannot collect CAM publication: root compiler reference differs from its original source artifact")
  const expected = camPublicationReference(plan, reference.expectedDeployer, components, compilation.abi)
  if (!isDeepStrictEqual(expected.steps, reference.steps)) throw new Error("Cannot collect CAM publication: approved steps differ from the independent composition recipe")
  const target = plan.root.kind === "new" ? { kind: "new" as const } : { kind: "existing" as const,
    sourceCommit: plan.root.sourceCommit, creator: plan.root.creator, contract: plan.root.contract }
  if (!isDeepStrictEqual(reference.root, target)) throw new Error("Cannot collect CAM publication: admitted root target differs from the saved plan")
  const hashes: Hex[] = []
  const failed: Hex[] = []
  let createdRoot: ContractIdentity | undefined
  if (reference.steps.length !== 0) {
    const auditBytes = await readBoundedRegularFile(resolve(requiredEnv(env, "CAM_RELEASE_AUDIT_DIR"), "approval.jsonl"), "CAM approval transmission audit", 16 * 1024 * 1024)
    const pending = new Set<Hex>()
    const transmitted = new Set<Hex>()
    for (const line of new TextDecoder().decode(auditBytes).trim().split("\n")) {
      const event = parseJsonRecord(new TextEncoder().encode(line), "CAM approval audit event")
      if (event.kind === "pending") {
        if (event.referenceDigest !== reference.snapshotSha256) throw new Error("Cannot collect CAM attempt: transmission audit belongs to a different approval reference")
        pending.add(requiredTransactionHash(event.hash, "pending CAM transaction"))
      } else if (event.kind === "transmitting") {
        const hash = requiredTransactionHash(event.hash, "transmitting CAM transaction")
        if (!pending.has(hash)) throw new Error(`Cannot collect CAM transaction ${hash}: no matching independently approved pending transaction`)
        transmitted.add(hash)
      }
    }
    if (transmitted.size > reference.steps.length) throw new Error("Cannot collect CAM attempt: more transmitted transactions than approved steps")
    const verifier = new ReleaseVerifier(reference, async hash => {
      const receipt = await client.getTransactionReceipt({ hash })
      return { transactionHash: receipt.transactionHash, status: receipt.status === "success" ? "0x1" : "0x0", contractAddress: receipt.contractAddress }
    })
    for (const hash of transmitted) {
      const [transaction, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })])
      if (receipt.blockNumber > blockNumber) throw new Error(`Cannot collect CAM transaction ${hash}: receipt is later than observation block ${blockNumber}`)
      if (transaction.type !== "eip1559") throw new Error(`Cannot collect CAM transaction ${hash}: signed type-2 transaction required`)
      const raw = serializeTransaction({ ...transaction, data: transaction.input }, { r: transaction.r, s: transaction.s, yParity: transaction.yParity })
      const review = await verifier.inspect(raw)
      if (review.signed.hash !== hash || receipt.transactionHash !== hash
          || getAddress(receipt.from) !== getAddress(reference.expectedDeployer)
          || (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) throw new Error(`Cannot collect CAM transaction ${hash}: signed bytes or canonical receipt differ`)
      if (receipt.status !== "success") {
        failed.push(hash)
        if (transmitted.size !== hashes.length + failed.length) throw new Error("Cannot continue CAM attempt: transactions were transmitted after a reverted step")
        break
      }
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
  const complete = hashes.length === reference.steps.length
  const address = identity.address
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({ address, abi: compilation.abi,
    functionName, ...(args === undefined ? {} : { args }), blockNumber })
  const bindings: Record<string, `0x${string}`> = {}
  for (const binding of plan.bindings) {
    const expectedAddress = typeof binding.address === "string" ? binding.address : address
    const actual = getAddress(await read("contractAddress", [binding.name]) as string)
    const before = plan.root.kind === "new" ? "0x0000000000000000000000000000000000000000" : plan.root.bindings[binding.name]!
    if (!sameAddress(actual, expectedAddress) && (complete || !sameAddress(actual, before))) throw new Error(`Cannot collect CAM root ${address}: binding ${binding.name}=${actual} differs from desired ${expectedAddress}`)
    bindings[binding.name] = actual
  }
  const manifest = await read("camManifest") as { uri: string; sha256Digest: Hex }
  const observedManifest = { uri: manifest.uri, hash: manifest.sha256Digest }
  const beforeManifest = plan.root.kind === "new" ? plan.manifest : plan.root.manifest
  if (!sameManifest(observedManifest, plan.manifest) && (complete || !sameManifest(observedManifest, beforeManifest))) throw new Error(`Cannot collect CAM root ${address}: current manifest differs from the composed URI/hash`)
  const authority = { owner: getAddress(await read("owner") as string), pendingOwner: getAddress(await read("pendingOwner") as string) }
  const beforeAuthority = plan.root.kind === "new" ? { owner: reference.expectedDeployer, pendingOwner: zeroAddress }
    : { owner: plan.root.owner, pendingOwner: plan.root.pendingOwner }
  if (complete) assertCamNominationComplete(address, beforeAuthority, camNominationOwner(plan), authority)
  else assertCamAuthorityProgress(address, beforeAuthority, camNominationOwner(plan), authority)
  if ((await client.getBlock({ blockNumber })).hash !== block.hash) throw new Error("Cannot collect CAM publication: its canonical observation block changed while reading receipts or state")
  const fields = { app: plan.app,
    sourceCommit: plan.sourceCommit, chainId: plan.expectedChainId, signer: reference.expectedDeployer,
    planSha256: reference.planSha256, referenceSha256: reference.snapshotSha256,
    businessArtifactSha256: plan.businessArtifactSha256, uiArtifactSha256: plan.uiArtifactSha256, bundleArtifactSha256: plan.bundleArtifactSha256,
    root: { sourceCommit: plan.root.kind === "new" ? plan.sourceCommit : plan.root.sourceCommit, creator, contract: observedRoot.identity },
    bindings, manifest: observedManifest, authority, transactions: hashes, verificationBlock: { number: toHex(blockNumber), hash: block.hash },
    predecessor: plan.root.kind === "new" ? null : plan.root.origin }
  const candidate = complete ? parseCamPublication(new TextEncoder().encode(JSON.stringify({ schema: "cam.publication.v1", ...fields })), plan.app)
    : parseCamAttempt(new TextEncoder().encode(JSON.stringify({ schema: "cam.publication-attempt.v1", ...fields,
        plan, bundleRootSha256: prepared.rootSha256, failedTransactions: failed })), plan.app)
  await writeNewJson(candidatePath, candidate, "CAM publication candidate")
  process.stdout.write(`${JSON.stringify({ event: "cam_publication_observed", app: plan.app, root: address, authority, verificationBlock: candidate.verificationBlock })}\n`)
}

runReleaseTool(main)
