import assert from "node:assert/strict"
import test from "node:test"
import { privateKeyToAccount } from "viem/accounts"
import { encodeAbiParameters, fromRlp, getContractAddress, keccak256, parseAbiParameters, toFunctionSelector, toRlp, type Address, type Hex } from "viem"

import type { ReferenceSnapshot } from "./reference-snapshot.ts"
import { ReleaseVerifier, type CreationReceipt } from "./verifier.ts"

const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
const zeroHash = `0x${"00".repeat(32)}` as Hex
const rootAbi = [
  { type: "constructor", stateMutability: "nonpayable", inputs: [{ type: "address" }] },
  { type: "function", name: "bind", stateMutability: "nonpayable", inputs: [{ type: "address" }], outputs: [] },
] as const
const childAbi = [{ type: "constructor", stateMutability: "nonpayable", inputs: [] }] as const

function snapshot(): ReferenceSnapshot {
  return {
    schema: "release-approval.reference.v2", app: "escrow", sourceCommit: "a".repeat(40),
    expectedChainId: 8453, expectedDeployer: account.address, planSha256: zeroHash,
    steps: [
      { kind: "create", role: "root", name: "Root", action: "Deploy root", argumentLabels: ["Deployment account"], constructorTypes: ["address"], args: [account.address] },
      { kind: "create", role: "child", name: "Child", action: "Deploy child", argumentLabels: [], constructorTypes: [], args: [] },
      { kind: "call", role: "root", name: "bind", action: "Bind child", argumentLabels: ["Verified Child contract"], signature: "bind(address)", args: [{ createdContract: "child" }] },
    ],
    contracts: [
      { role: "root", name: "Root", source: "root.sol", compilerVersion: "0.8.35", compilerMetadataSha256: zeroHash, artifactSha256: zeroHash, creationBytecode: "0x60016002", abi: rootAbi },
      { role: "child", name: "Child", source: "child.sol", compilerVersion: "0.8.35", compilerMetadataSha256: zeroHash, artifactSha256: zeroHash, creationBytecode: "0x60036004", abi: childAbi },
    ],
    snapshotSha256: zeroHash,
  }
}

async function signed(nonce: number, input: { to?: Address; data: Hex; value?: bigint }): Promise<Hex> {
  return account.signTransaction({ type: "eip1559", chainId: 8453, nonce,
    gas: 200_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
    value: input.value === undefined ? 0n : input.value, data: input.data, ...(input.to === undefined ? {} : { to: input.to }) })
}

function success(hash: Hex, address: Address): CreationReceipt {
  return { transactionHash: hash, status: "0x1", contractAddress: address }
}

test("ordered signed creations require exact bytecode and canonical constructor bytes", async () => {
  const verifier = new ReleaseVerifier(snapshot(), async () => null)
  const suffix = encodeAbiParameters(parseAbiParameters("address"), [account.address])
  const raw = await signed(0, { data: `0x60016002${suffix.slice(2)}` })
  const review = await verifier.inspect(raw)
  assert.equal(review.step.kind, "create")
  assert.equal(review.signed.hash, keccak256(raw))
  assert.equal(review.signed.valueWei, "0")
  assert.equal(review.signed.gasLimit, "200000")
  assert.equal(review.signed.maxFeePerGasWei, "2000000000")
  assert.equal(review.comparison.creationBytecodeMatched, true)
  assert.equal(review.comparison.predictedAddress, getContractAddress({ from: account.address, nonce: 0n }))
  assert.equal(review.comparison.expectedArgs[0], account.address)
  await assert.rejects(new ReleaseVerifier(snapshot(), async () => null).inspect(
    await signed(0, { data: `0x60016003${suffix.slice(2)}` })), /bytecode/i)
  await assert.rejects(new ReleaseVerifier(snapshot(), async () => null).inspect(
    await signed(0, { data: `0x60016002${"00".repeat(32)}` })), /constructor arguments/i)
  verifier.accepted(review.signed.hash)
  assert.equal(verifier.stepIndex(), 1)
  await assert.rejects(verifier.inspect(await signed(1, { data: "0x60036004", value: 1n })), /native value/i)
})

test("signed chain, recovered sender and canonical transaction encoding must match", async () => {
  const data = `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [account.address]).slice(2)}` as Hex
  const wrongChain = await account.signTransaction({ type: "eip1559", chainId: 1, nonce: 0, gas: 200_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, value: 0n, data })
  await assert.rejects(new ReleaseVerifier(snapshot(), async () => null).inspect(wrongChain), /chain or sender/i)

  const other = privateKeyToAccount(`0x${"22".repeat(32)}`)
  const wrongSender = await other.signTransaction({ type: "eip1559", chainId: 8453, nonce: 0, gas: 200_000n,
    maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, value: 0n, data })
  await assert.rejects(new ReleaseVerifier(snapshot(), async () => null).inspect(wrongSender), /chain or sender/i)

  const canonical = await signed(0, { data })
  const fields = fromRlp(`0x${canonical.slice(4)}`) as Hex[]
  fields[1] = "0x00"
  const paddedZeroNonce = `0x02${toRlp(fields).slice(2)}` as Hex
  assert.notEqual(paddedZeroNonce, canonical)
  await assert.rejects(new ReleaseVerifier(snapshot(), async () => null).inspect(paddedZeroNonce), /canonical|invalid|nonce/i)
})

test("constructor address reference needs a matching successful creation receipt", async () => {
  const base = snapshot()
  const dependent: ReferenceSnapshot = {
    ...base,
    steps: [base.steps[0]!, { kind: "create", role: "child", name: "Child", action: "Deploy child backed by root", argumentLabels: ["Verified Root contract"], constructorTypes: ["address"],
      args: [{ createdContract: "root" }] }, base.steps[2]!],
    contracts: base.contracts.map((contract) => contract.role === "child" ? {
      ...contract, abi: [{ type: "constructor", stateMutability: "nonpayable", inputs: [{ type: "address" }] }],
    } : contract),
  }
  let receipt: CreationReceipt | null = null
  const verifier = new ReleaseVerifier(dependent, async () => receipt)
  const rootData = `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [account.address]).slice(2)}` as Hex
  const root = await verifier.inspect(await signed(0, { data: rootData }))
  verifier.accepted(root.signed.hash)
  const rootAddress = getContractAddress({ from: account.address, nonce: 0n })
  const childData = `0x60036004${encodeAbiParameters(parseAbiParameters("address"), [rootAddress]).slice(2)}` as Hex
  const child = await signed(1, { data: childData })
  await assert.rejects(verifier.inspect(child), /receipt.*root|root.*receipt/i)
  receipt = { ...success(root.signed.hash, rootAddress), status: "0x0" }
  await assert.rejects(verifier.inspect(child), /receipt.*root|root.*receipt/i)
  receipt = { ...success(root.signed.hash, rootAddress), contractAddress: account.address }
  await assert.rejects(verifier.inspect(child), /receipt.*root|root.*receipt/i)
  receipt = success(root.signed.hash, rootAddress)
  const review = await verifier.inspect(child)
  assert.equal(review.comparison.expectedArgs[0], rootAddress)
  assert.equal(verifier.stepIndex(), 1)
})

test("dependent call requires matching successful creation receipts and exact target and calldata", async () => {
  const receipts = new Map<Hex, CreationReceipt | null>()
  const verifier = new ReleaseVerifier(snapshot(), async (hash) => {
    const receipt = receipts.get(hash)
    return receipt === undefined ? null : receipt
  })
  const rootData = `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [account.address]).slice(2)}` as Hex
  const root = await verifier.inspect(await signed(0, { data: rootData }))
  verifier.accepted(root.signed.hash)
  const child = await verifier.inspect(await signed(1, { data: "0x60036004" }))
  verifier.accepted(child.signed.hash)
  const rootAddress = getContractAddress({ from: account.address, nonce: 0n })
  const childAddress = getContractAddress({ from: account.address, nonce: 1n })
  const callData = `${toFunctionSelector("bind(address)")}${encodeAbiParameters(parseAbiParameters("address"), [childAddress]).slice(2)}` as Hex
  const call = await signed(2, { to: rootAddress, data: callData })
  await assert.rejects(verifier.inspect(call), /receipt.*child|child.*receipt/i)
  receipts.set(child.signed.hash, success(child.signed.hash, childAddress))
  await assert.rejects(verifier.inspect(call), /receipt.*root|root.*receipt/i)
  receipts.set(root.signed.hash, success(root.signed.hash, rootAddress))
  receipts.set(child.signed.hash, { ...success(child.signed.hash, childAddress), status: "0x0" })
  await assert.rejects(verifier.inspect(call), /receipt.*child|child.*receipt/i)
  receipts.set(child.signed.hash, { ...success(child.signed.hash, childAddress), transactionHash: zeroHash })
  await assert.rejects(verifier.inspect(call), /receipt.*child|child.*receipt/i)
  receipts.set(child.signed.hash, success(child.signed.hash, rootAddress))
  await assert.rejects(verifier.inspect(call), /receipt.*child|child.*receipt/i)
  receipts.set(child.signed.hash, success(child.signed.hash, childAddress))
  await assert.rejects(verifier.inspect(await signed(2, { to: childAddress, data: callData })), /target/i)
  await assert.rejects(verifier.inspect(await signed(2, { to: rootAddress, data: `${toFunctionSelector("bind(address)")}${"00".repeat(32)}` })), /calldata/i)
  const review = await verifier.inspect(call)
  assert.equal(review.comparison.targetRole, "root")
  assert.equal(review.comparison.targetAddress, rootAddress)
  assert.equal(review.comparison.expectedArgs[0], childAddress)
  assert.equal(review.signed.calldata, callData)
  verifier.accepted(review.signed.hash)
  assert.equal(verifier.stepIndex(), 3)
})

test("a candidate without accepted submission does not advance the reference sequence", async () => {
  const verifier = new ReleaseVerifier(snapshot(), async () => null)
  const data = `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [account.address]).slice(2)}` as Hex
  const raw = await signed(0, { data })
  const review = await verifier.inspect(raw)
  assert.equal(verifier.stepIndex(), 0)
  verifier.notAccepted(review.signed.hash)
  assert.equal(verifier.stepIndex(), 0)
  const retry = await verifier.inspect(raw)
  assert.equal(retry.signed.hash, review.signed.hash)
  assert.throws(() => verifier.accepted(zeroHash), /hash/i)
  assert.equal(verifier.stepIndex(), 0)
})

test("parallel exact duplicate inspections join one receipt lookup; different bytes cannot race", async () => {
  const receipts = new Map<Hex, CreationReceipt | null>()
  let reads = 0
  let heldHash: Hex | null = null
  let finishRead: ((receipt: CreationReceipt | null) => void) | undefined
  let markRead: (() => void) | undefined
  const readStarted = new Promise<void>((resolve) => { markRead = resolve })
  const verifier = new ReleaseVerifier(snapshot(), async (hash) => {
    reads += 1
    markRead?.()
    if (hash === heldHash) return new Promise<CreationReceipt | null>((resolve) => { finishRead = resolve })
    const receipt = receipts.get(hash)
    return receipt === undefined ? null : receipt
  })
  const rootData = `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [account.address]).slice(2)}` as Hex
  const root = await verifier.inspect(await signed(0, { data: rootData }))
  verifier.accepted(root.signed.hash)
  const child = await verifier.inspect(await signed(1, { data: "0x60036004" }))
  verifier.accepted(child.signed.hash)
  const rootAddress = getContractAddress({ from: account.address, nonce: 0n })
  const childAddress = getContractAddress({ from: account.address, nonce: 1n })
  heldHash = child.signed.hash
  receipts.set(root.signed.hash, success(root.signed.hash, rootAddress))
  const callData = `${toFunctionSelector("bind(address)")}${encodeAbiParameters(parseAbiParameters("address"), [childAddress]).slice(2)}` as Hex
  const call = await signed(2, { to: rootAddress, data: callData })
  const first = verifier.inspect(call)
  const duplicate = verifier.inspect(call)
  await assert.rejects(verifier.inspect(await signed(3, { to: rootAddress, data: callData })), /another candidate/i)
  await readStarted
  assert.throws(() => verifier.accepted(keccak256(call)), /hash/i)
  assert.equal(verifier.stepIndex(), 2)
  assert.equal(reads, 1)
  assert.ok(finishRead)
  finishRead(success(child.signed.hash, childAddress))
  const reviews = await Promise.all([first, duplicate])
  assert.equal(reviews[0], reviews[1])
  assert.equal(reads, 2)
  assert.equal(verifier.stepIndex(), 2)
  verifier.accepted(reviews[0]!.signed.hash)
  assert.equal(verifier.stepIndex(), 3)
})
