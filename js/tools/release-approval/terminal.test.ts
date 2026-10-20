import assert from "node:assert/strict"
import { PassThrough, Writable } from "node:stream"
import test from "node:test"
import { encodeAbiParameters, getContractAddress, parseAbiParameters, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type { ReferenceSnapshot } from "./reference-snapshot.ts"
import type { TransactionReview } from "./verifier.ts"
import { ReleaseVerifier } from "./verifier.ts"
import { ApprovalTerminal } from "./terminal.ts"

const hash = `0x${"a".repeat(64)}` as Hex
const sender = `0x${"1".repeat(40)}` as Address
const target = `0x${"2".repeat(40)}` as Address
const digest = `0x${"b".repeat(64)}` as Hex
const challenge = "a1a2a3a4-b1b2-c1c2-d1d2-e1e2e3e4e5e6"

function review(overrides?: Partial<TransactionReview>): TransactionReview {
  return {
    stepIndex: 0,
    step: { kind: "call", role: "camRoot", name: "bind", signature: "bind(address)", args: [target] },
    signed: { hash, sender, chainId: 84532, nonce: 7, to: target, valueWei: "0", gasLimit: "21001",
      maxFeePerGasWei: "100000000001", maxPriorityFeePerGasWei: "2000000000", accessList: [],
      calldata: `0x${"fe".repeat(3000)}`, calldataHash: digest },
    comparison: { targetRole: "camRoot", targetAddress: target, creationBytecodeMatched: null,
      predictedAddress: null, expectedArgs: [target], expectedCalldata: "0x", artifactSha256: digest,
      compilerMetadataSha256: digest },
    ...overrides,
  }
}

function fixture(candidate?: TransactionReview) {
  const selected = candidate === undefined ? review() : candidate
  const input = Object.assign(new PassThrough(), { isTTY: true })
  const output = Object.assign(new PassThrough(), { isTTY: true })
  let printed = ""
  output.on("data", chunk => { printed += chunk.toString() })
  let pending: { hash: Hex; sender: Address; chainId: number; nonce: number; challenge: string; deadline: number; referenceDigest: Hex } | null =
    { hash: selected.signed.hash, sender: selected.signed.sender, chainId: selected.signed.chainId,
      nonce: selected.signed.nonce, challenge, deadline: 5000, referenceDigest: digest }
  const decisions: [string, string][] = []
  const closures: string[] = []
  const owner = {
    pending: () => pending,
    decide: async (token: string, decision: "approve" | "reject") => { decisions.push([token, decision]); pending = null },
    close: (reason: string) => { closures.push(reason); pending = null },
  }
  const terminal = new ApprovalTerminal({ input, output, owner, reviewForHash: queried => queried === selected.signed.hash ? selected : null,
    referenceName: "reference\u202e.json", now: () => 1000, pageCharacters: 800 })
  terminal.start()
  return { terminal, input, output, owner, decisions, closures, printed: () => printed,
    replacePending: (value: typeof pending) => { pending = value }, close: () => { terminal.stop(); input.destroy(); output.destroy() } }
}

async function settle() { await new Promise<void>(resolve => setImmediate(resolve)) }

test("summary distinguishes signed facts and reference comparisons, uses exact fee arithmetic, and escapes terminal controls", () => {
  const f = fixture(review({ step: { kind: "call", role: "camRoot", name: "bind\u001b[31m\u202e", signature: "bind(address)", args: [target] } }))
  try {
    f.terminal.poll()
    const text = f.printed()
    assert.match(text, /Signed transaction/)
    assert.match(text, /Reference comparison/)
    assert.match(text, new RegExp(hash))
    assert.match(text, new RegExp(sender))
    assert.match(text, /21001/)
    assert.match(text, /2100100000021001/) // 21001 * 100000000001, exact bigint
    assert.match(text, /Other chain fees: not established/)
    assert.match(text, /\\u001b\[31m\\u202e/)
    assert.doesNotMatch(text, /\u001b|\u202e/)
    assert.ok(text.length < 4000)
  } finally { f.close() }
})

test("real signed type-2 creation without an access list remains reviewable and shows its constructor address", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
  const source: ReferenceSnapshot = {
    schema: "release-approval.reference.v1", app: "escrow", sourceCommit: "a".repeat(40),
    expectedChainId: 84532, expectedDeployer: account.address, planSha256: digest,
    steps: [{ kind: "create", role: "root", name: "Root", constructorTypes: ["address"], args: [target] }],
    contracts: [{ role: "root", name: "Root", source: "root.sol", compilerVersion: "0.8.35",
      compilerMetadataSha256: digest, artifactSha256: digest, creationBytecode: "0x60016002",
      abi: [{ type: "constructor", stateMutability: "nonpayable", inputs: [{ type: "address" }] }] }],
    snapshotSha256: digest,
  }
  const raw = await account.signTransaction({ type: "eip1559", chainId: 84532, nonce: 0, gas: 200000n,
    maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 100000000n, value: 0n,
    data: `0x60016002${encodeAbiParameters(parseAbiParameters("address"), [target]).slice(2)}` })
  const inspected = await new ReleaseVerifier(source, async () => null).inspect(raw)
  assert.equal(inspected.signed.accessList, undefined)
  const f = fixture(inspected)
  try {
    f.terminal.poll()
    assert.deepEqual(f.closures, [])
    assert.match(f.printed(), new RegExp(`1: ${target}`))
    const predicted = getContractAddress({ from: account.address, nonce: 0n })
    assert.match(f.printed(), new RegExp(`Predicted creation address: ${predicted}`))
    f.input.write(`inspect ${challenge} 1\n`)
    await settle()
    assert.match(f.printed(), /Access list: \[\]/)
  } finally { f.close() }
})

test("recipient values appear in the summary, with long values explicitly abbreviated", () => {
  const long = "x".repeat(300)
  const f = fixture(review({ step: { kind: "call", role: "root", name: "setRecipient",
    signature: "setRecipient(address,string)", args: [target, long] },
  comparison: { ...review().comparison, expectedArgs: [target, long] } }))
  try {
    f.terminal.poll()
    assert.match(f.printed(), /setRecipient\(address,string\)/)
    assert.match(f.printed(), new RegExp(`1: ${target}`))
    assert.match(f.printed(), /2: x{100}\.\.\. \[full value in inspect pages\]/)
    assert.ok(f.printed().length < 4000)
  } finally { f.close() }
})

test("ownership transfer separates the call target from the new owner argument", () => {
  const newOwner = `0x${"3".repeat(40)}` as Address
  const f = fixture(review({ step: { kind: "call", role: "root", name: "transferOwnership",
    signature: "transferOwnership(address)", args: [newOwner] },
  comparison: { ...review().comparison, expectedArgs: [newOwner] } }))
  try {
    f.terminal.poll()
    assert.match(f.printed(), new RegExp(`Target: ${target}`))
    assert.match(f.printed(), new RegExp(`1: ${newOwner}`))
  } finally { f.close() }
})

test("only the displayed challenge authorizes this pending hash; blank and old buffered input do nothing", async () => {
  const f = fixture()
  try {
    f.input.write(`approve old-token\napprove\nyes\n\n`)
    f.terminal.poll()
    f.input.write(`approve old-token\n`)
    await settle()
    assert.deepEqual(f.decisions, [])
    f.input.write(`approve ${challenge}\n`)
    await settle()
    assert.deepEqual(f.decisions, [[challenge, "approve"]])
  } finally { f.close() }
})

test("an old challenge cannot authorize a newly displayed request", async () => {
  const f = fixture()
  try {
    f.terminal.poll()
    const nextChallenge = "11111111-2222-3333-4444-555555555555"
    f.replacePending({ hash, sender, chainId: 84532, nonce: 7, challenge: nextChallenge,
      deadline: 6000, referenceDigest: digest })
    f.terminal.poll()
    f.input.write(`approve ${challenge}\napprove ${nextChallenge}\n`)
    await settle()
    assert.deepEqual(f.decisions, [[nextChallenge, "approve"]])
  } finally { f.close() }
})

test("rejection also requires the current challenge", async () => {
  const f = fixture()
  try {
    f.terminal.poll()
    f.input.write(`reject old-token\nreject ${challenge}\n`)
    await settle()
    assert.deepEqual(f.decisions, [[challenge, "reject"]])
  } finally { f.close() }
})

test("full calldata is inspectable in bounded pages", async () => {
  const f = fixture()
  try {
    f.terminal.poll()
    const initial = f.printed().length
    f.input.write(`inspect ${challenge} 1\n`)
    await settle()
    const page = f.printed().slice(initial)
    assert.match(page, /Full data page 1/)
    assert.ok(page.length <= 1200)
    assert.match(page, /fefefe/)
    f.input.write(`inspect ${challenge} 9\n`)
    await settle()
    assert.match(f.printed(), /Full data page 9 of 9/)
    assert.match(f.printed(), /Expected calldata: 0x/)
  } finally { f.close() }
})

test("mismatched or absent verification blocks the prompt and closes the ceremony", () => {
  const f = fixture(review({ signed: { ...review().signed, hash: digest } }))
  try {
    f.replacePending({ hash, sender, chainId: 84532, nonce: 7, challenge, deadline: 5000, referenceDigest: digest })
    f.terminal.poll()
    assert.equal(f.closures.length, 1)
    assert.doesNotMatch(f.printed(), /Approve with/)
  } finally { f.close() }
})

test("blocked terminal output closes approval before operator input can authorize it", () => {
  const f = fixture()
  try {
    f.close()
    const input = Object.assign(new PassThrough(), { isTTY: true })
    const output = Object.assign(new Writable({ highWaterMark: 1, write(_chunk, _encoding, _done) {} }), { isTTY: true })
    const terminal = new ApprovalTerminal({ input, output, owner: f.owner, reviewForHash: () => review(),
      referenceName: "reference", now: () => 1000, pageCharacters: 800 })
    try {
      terminal.start()
      terminal.poll()
      input.write(`approve ${challenge}\n`)
      assert.deepEqual(f.decisions, [])
      assert.deepEqual(f.closures, ["operator terminal output blocked"])
    } finally { terminal.stop(); input.destroy(); output.destroy() }
  } finally { f.close() }
})

test("closing the output terminal refuses the pending request", async () => {
  const f = fixture()
  try {
    f.terminal.poll()
    f.output.destroy()
    await settle()
    f.input.write(`approve ${challenge}\n`)
    assert.deepEqual(f.decisions, [])
    assert.deepEqual(f.closures, ["operator terminal detached"])
  } finally { f.close() }
})

test("EOF detaches and refuses a pending ceremony", async () => {
  const f = fixture()
  try {
    f.terminal.poll()
    f.input.end()
    await settle()
    assert.deepEqual(f.decisions, [])
    assert.deepEqual(f.closures, ["operator terminal detached"])
  } finally { f.close() }
})

test("oversized commands close approval without a decision", () => {
  const f = fixture()
  try {
    f.terminal.poll()
    f.input.write("x".repeat(257))
    assert.deepEqual(f.decisions, [])
    assert.deepEqual(f.closures, ["operator command exceeds 256 characters"])
  } finally { f.close() }
})

test("no attached TTY cannot start", () => {
  const f = fixture()
  try {
    f.close()
    const input = Object.assign(new PassThrough(), { isTTY: false })
    const output = Object.assign(new PassThrough(), { isTTY: true })
    assert.throws(() => new ApprovalTerminal({ input, output, owner: f.owner,
      reviewForHash: () => review(), referenceName: "reference", now: () => 0, pageCharacters: 800 }).start(), /TTY/)
  } finally { f.close() }
})
