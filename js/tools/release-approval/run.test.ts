import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer as createHttpServer } from "node:http"
import { connect } from "node:net"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import test from "node:test"
import type { Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import type { ReferenceSnapshot } from "./reference-snapshot.ts"
import { approvalShutdownReason, assertReferenceIdentity, settingsFromEnv, startApprovalRuntime, type RuntimeSettings } from "./run.ts"

const commit = "a".repeat(40)
const digest = `0x${"ab".repeat(32)}` as Hex
const deployer = "0x0000000000000000000000000000000000000011"

function operatorInput() {
  return Object.assign(new PassThrough(), { isTTY: true, isRaw: false,
    setRawMode(enabled: boolean) { this.isRaw = enabled; return this } })
}

function snapshot(deployerAddress = deployer): ReferenceSnapshot {
  const contracts = [
    { role: "camRoot", name: "CamRoot", source: "cam/src/CamRoot.sol", abi: [
      { type: "constructor", inputs: [{ type: "address" }, { type: "string" }, { type: "bytes32" }] },
      { type: "function", name: "setContractAddress", inputs: [{ type: "string" }, { type: "address" }] },
    ] },
    { role: "escrow", name: "CamEscrow", source: "escrow/src/CamEscrow.sol", abi: [{ type: "constructor", inputs: [] }] },
    { role: "ui", name: "CamEscrowUI", source: "escrow/src/CamEscrowUI.sol", abi: [{ type: "constructor", inputs: [{ type: "address" }] }] },
  ].map(contract => ({ ...contract, compilerVersion: "0.8.35+commit.47b9dedd", compilerMetadataSha256: digest,
    artifactSha256: digest, creationBytecode: "0x60006000" as Hex }))
  const base = {
    schema: "release-approval.reference.v2" as const, app: "escrow" as const, sourceCommit: commit,
    expectedChainId: 8453, expectedDeployer: deployerAddress, planSha256: digest,
    contracts,
    steps: [
      { kind: "create" as const, role: "camRoot", name: "CamRoot", constructorTypes: ["address", "string", "bytes32"], args: [deployerAddress, "https://example.test/cam", digest], action: "Deploy CAM root", argumentLabels: ["Initial CAM owner", "Published CAM URI", "CAM SHA-256"] },
      { kind: "create" as const, role: "escrow", name: "CamEscrow", constructorTypes: [], args: [], action: "Deploy escrow", argumentLabels: [] },
      { kind: "create" as const, role: "ui", name: "CamEscrowUI", constructorTypes: ["address"], args: [{ createdContract: "escrow" }], action: "Deploy escrow UI", argumentLabels: ["Verified escrow contract"] },
      { kind: "call" as const, role: "camRoot", name: "setContractAddress", signature: "setContractAddress(string,address)", args: ["CamEscrowUI", { createdContract: "ui" }], action: "Bind escrow UI in CAM", argumentLabels: ["Contract name", "Verified escrow UI contract"] },
    ],
  }
  return { ...base, snapshotSha256: `0x${createHash("sha256").update(JSON.stringify(base)).digest("hex")}` } as ReferenceSnapshot
}

function settings(root: string, reference: ReferenceSnapshot): RuntimeSettings {
  return {
    referencePath: join(root, "reference.json"), referenceSha256: reference.snapshotSha256,
    sourceCommit: commit, planSha256: digest, app: "escrow", chainId: 8453, deployer: reference.expectedDeployer,
    socketPath: join(root, "socket", "rpc.sock"), auditDir: join(root, "audit"),
    backendUrl: "http://127.0.0.1:8976",
  }
}

test("ceremony identity compares independent digest, source, plan, app, chain and deployer", () => {
  const reference = snapshot()
  const selected = settings("/tmp/approval", reference)
  assert.doesNotThrow(() => assertReferenceIdentity(reference, selected))
  for (const [field, changed] of [
    ["referenceSha256", `0x${"cd".repeat(32)}`], ["sourceCommit", "b".repeat(40)],
    ["planSha256", `0x${"cd".repeat(32)}`], ["app", "bike-nft"],
    ["chainId", 1], ["deployer", "0x0000000000000000000000000000000000000022"],
  ] as const) {
    assert.throws(() => assertReferenceIdentity(reference, { ...selected, [field]: changed }), /selected.*reference/i, field)
  }
})

test("SIGTERM cannot turn a previously closed or still active owner into a completed approval", () => {
  assert.equal(approvalShutdownReason("SIGTERM", 5, 5, true, null), "approval complete")
  assert.match(approvalShutdownReason("SIGTERM", 5, 5, true, "transaction inspection failed"), /approval closed before completion/)
  assert.match(approvalShutdownReason("SIGTERM", 5, 5, false, null), /before all approved steps completed/)
  assert.match(approvalShutdownReason("SIGTERM", 4, 5, true, null), /before all approved steps completed/)
})

test("runtime settings require explicit canonical chain and all independent pins", () => {
  const reference = snapshot()
  const selected = settings("/tmp/approval", reference)
  const env = {
    RELEASE_APPROVAL_REFERENCE_PATH: selected.referencePath,
    RELEASE_APPROVAL_REFERENCE_SHA256: selected.referenceSha256,
    RELEASE_APPROVAL_SOURCE_COMMIT: selected.sourceCommit,
    RELEASE_APPROVAL_PLAN_SHA256: selected.planSha256,
    RELEASE_APPROVAL_APP: selected.app,
    RELEASE_APPROVAL_CHAIN_ID: String(selected.chainId),
    RELEASE_APPROVAL_DEPLOYER: selected.deployer,
    RELEASE_APPROVAL_SOCKET_PATH: selected.socketPath,
    RELEASE_APPROVAL_AUDIT_DIR: selected.auditDir,
    RELEASE_APPROVAL_BACKEND_URL: selected.backendUrl,
  }
  assert.equal(settingsFromEnv(env).chainId, 8453)
  assert.throws(() => settingsFromEnv({ ...env, RELEASE_APPROVAL_CHAIN_ID: "8.453e3" }), /decimal integer/)
  assert.throws(() => settingsFromEnv({ ...env, RELEASE_APPROVAL_PLAN_SHA256: undefined }), /PLAN_SHA256/)
  assert.throws(() => settingsFromEnv({ ...env, RELEASE_APPROVAL_DEPLOYER: "0x00" }), /address/i)
})

test("startup rejects changed reference before opening the audit or socket", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  try {
    const reference = snapshot()
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = operatorInput()
    const output = operatorInput()
    await assert.rejects(startApprovalRuntime({ ...selected, referenceSha256: `0x${"cd".repeat(32)}` }, { input, output }), /selected.*reference/i)
    assert.deepEqual(await readFile(selected.referencePath, "utf8"), JSON.stringify(reference))
    await assert.rejects(stat(join(root, "audit", "approval.jsonl")), { code: "ENOENT" })
    await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("runtime requires an attached operator terminal before accepting connections", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  try {
    const reference = snapshot()
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = new PassThrough()
    const output = new PassThrough()
    await assert.rejects(startApprovalRuntime(selected, { input, output }), /operator TTY/i)
    await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const phase of ["before start", "after start", "wrong command", "input EOF", "missing reference"] as const) {
  test(`executable reports its cause and releases operator input: ${phase}`, async t => {
    const root = await mkdtemp(join(tmpdir(), "approval-process-"))
    t.after(() => rm(root, { recursive: true, force: true }))
    const reference = snapshot()
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    if (phase === "missing reference") selected.referencePath = join(root, "private-reference-secret")
    else await writeFile(selected.referencePath, JSON.stringify(reference))
    const entrypoint = new URL("./run.ts", import.meta.url)
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `
      import { fileURLToPath } from 'node:url';
      process.stdin.isTTY = process.stdout.isTTY = true;
      process.stdin.setRawMode = enabled => { process.stdin.isRaw = enabled; return process.stdin; };
      process.argv[1] = fileURLToPath(${JSON.stringify(entrypoint.href)});
      await import(${JSON.stringify(entrypoint.href)});
    `], { stdio: ["pipe", "pipe", "pipe"], env: {
      ...process.env,
      RELEASE_APPROVAL_APP: selected.app, RELEASE_APPROVAL_CHAIN_ID: String(selected.chainId),
      RELEASE_APPROVAL_DEPLOYER: selected.deployer, RELEASE_APPROVAL_SOURCE_COMMIT: selected.sourceCommit,
      RELEASE_APPROVAL_REFERENCE_PATH: selected.referencePath,
      RELEASE_APPROVAL_REFERENCE_SHA256: selected.referenceSha256,
      RELEASE_APPROVAL_PLAN_SHA256: selected.planSha256,
      RELEASE_APPROVAL_SOCKET_PATH: selected.socketPath, RELEASE_APPROVAL_AUDIT_DIR: selected.auditDir,
      RELEASE_APPROVAL_BACKEND_URL: selected.backendUrl,
    } })
    t.after(() => { child.kill("SIGKILL"); child.stdin.destroy() })
    let printed = ""
    child.stdout.on("data", chunk => { printed += chunk.toString() })
    let errors = ""
    child.stderr.on("data", chunk => { errors += chunk.toString() })
    async function waitFor(text: string): Promise<void> {
      while (!printed.includes(text)) await once(child.stdout, "data", { signal: AbortSignal.timeout(3000) })
    }
    if (phase !== "missing reference") await waitFor("Type start and press Enter")
    if (phase === "after start") {
      child.stdin.write("start\n")
      await waitFor("Approval ready")
    }
    // Leave the operator pipe open: shutdown must release its own read handle.
    const ended = once(child, "exit", { signal: AbortSignal.timeout(1500) })
    if (phase === "wrong command") child.stdin.write("START\n")
    else if (phase === "input EOF") child.stdin.end()
    else if (phase !== "missing reference") child.kill("SIGTERM")
    const [status, signal] = await ended
    assert.equal(signal, null, errors)
    assert.equal(status, 1, errors)
    if (phase !== "after start") {
      const cause = phase === "wrong command" ? /exact start command/ :
        phase === "input EOF" ? /terminal detached before start/ :
        phase === "missing reference" ? /ENOENT.*open/ : /Operator start was interrupted/
      assert.match(errors, cause)
      assert.doesNotMatch(errors, /private-reference-secret/)
      await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
      await assert.rejects(stat(join(selected.auditDir, "approval.jsonl")), { code: "ENOENT" })
    }
  })
}

test("blank Enter repeats the selected release prompt without effects before exact start", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  try {
    const reference = snapshot()
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = operatorInput()
    const output = operatorInput()
    const starting = startApprovalRuntime(selected, { input, output })
    const [prompt] = await once(output, "data")
    for (const fact of ["escrow", "8453", deployer, commit, reference.snapshotSha256, "Type start and press Enter"]) {
      assert.match(String(prompt), new RegExp(fact))
    }
    await assert.rejects(stat(join(selected.auditDir, "approval.jsonl")), { code: "ENOENT" })
    await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
    for (const blank of ["\n", "\r\n"]) {
      const repeated = once(output, "data")
      input.write(blank)
      const [again] = await repeated
      assert.match(String(again), /Type start and press Enter/)
      await assert.rejects(stat(join(selected.auditDir, "approval.jsonl")), { code: "ENOENT" })
      await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
    }
    input.write("start\n")
    const runtime = await starting
    try { assert.equal((await stat(selected.socketPath)).isSocket(), true) }
    finally { await runtime.close("test cleanup") }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("a buffered operator prompt opens the socket only after the prompt drains and start is entered", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  try {
    const reference = snapshot()
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = operatorInput()
    let prompt = ""
    let finishPrompt: () => void = () => { throw new Error("Operator prompt was not written") }
    let firstWrite = true
    let sawPrompt!: () => void
    const promptReceived = new Promise<void>(resolve => { sawPrompt = resolve })
    const output = Object.assign(new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _encoding, done) {
        if (firstWrite) {
          firstWrite = false
          prompt = chunk.toString("utf8")
          finishPrompt = done
          sawPrompt()
        } else done()
      },
    }), { isTTY: true })
    const starting = startApprovalRuntime(selected, { input, output })
    await promptReceived
    assert.match(prompt, /Type start and press Enter/)
    assert.equal(output.writableNeedDrain, true)
    input.write("\n")
    input.write("\r\n")
    assert.equal(output.writableLength, Buffer.byteLength(prompt), "blank retries must not queue prompts behind blocked output")
    input.write("start\n")
    await assert.rejects(stat(join(selected.auditDir, "approval.jsonl")), { code: "ENOENT" })
    await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
    finishPrompt()
    const runtime = await starting
    try { assert.equal((await stat(selected.socketPath)).isSocket(), true) }
    finally { await runtime.close("test cleanup") }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test("operator detachment immediately after start cannot open the approval socket", async () => {
  for (const mode of ["input-end", "output-close"] as const) {
    const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
    try {
      const reference = snapshot()
      const selected = settings(root, reference)
      await mkdir(join(root, "socket"), { mode: 0o700 })
      await mkdir(selected.auditDir, { mode: 0o700 })
      await writeFile(selected.referencePath, JSON.stringify(reference))
      const input = operatorInput()
      const output = operatorInput()
      const starting = startApprovalRuntime(selected, { input, output })
      await once(output, "data")
      if (mode === "input-end") input.end("start\n")
      else { input.write("start\n"); output.destroy() }
      let runtime: Awaited<typeof starting> | null = null
      try {
        runtime = await starting
        assert.fail(`${mode} opened the approval socket after operator detachment`)
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error
        assert.match(String(error), /operator terminal detached|operator start/i)
      } finally {
        if (runtime !== null) await runtime.close("test cleanup")
      }
      await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test("EOF, interrupted start, and malformed or buffered commands leave no audit or socket", async () => {
  for (const mode of ["eof", "abort", "extra", "wrong", "oversize", "output-close"] as const) {
    const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
    try {
      const reference = snapshot()
      const selected = settings(root, reference)
      await mkdir(join(root, "socket"), { mode: 0o700 })
      await mkdir(selected.auditDir, { mode: 0o700 })
      await writeFile(selected.referencePath, JSON.stringify(reference))
      const input = operatorInput()
      const output = operatorInput()
      const controller = new AbortController()
      const starting = startApprovalRuntime(selected, { input, output, signal: controller.signal })
      await once(output, "data")
      if (mode === "eof") input.end()
      else if (mode === "abort") controller.abort()
      else if (mode === "extra") input.write("start\napprove old-challenge\n")
      else if (mode === "wrong") input.write("START\n")
      else if (mode === "oversize") input.write("x".repeat(33))
      else output.destroy()
      await assert.rejects(starting, /operator start|before start|extra command/i)
      await assert.rejects(stat(join(selected.auditDir, "approval.jsonl")), { code: "ENOENT" })
      await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test("runtime serves bounded reads through the socket and stops incomplete ceremonies", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  const backend = createHttpServer((request, response) => {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", chunk => { body += chunk })
    request.on("end", () => {
      const rpc = JSON.parse(body) as { id: string; method: string }
      assert.equal(rpc.method, "eth_chainId")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0x2105" }))
    })
  })
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
  try {
    const reference = snapshot()
    const selected = settings(root, reference)
    const address = backend.address()
    if (address === null || typeof address === "string") throw new Error("No test backend address")
    selected.backendUrl = `http://127.0.0.1:${address.port}`
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = operatorInput()
    const output = operatorInput()
    const starting = startApprovalRuntime(selected, { input, output })
    await once(output, "data")
    input.write("start\n")
    const runtime = await starting
    try {
      const socket = connect(selected.socketPath)
      const response = await new Promise<string>((resolve, reject) => {
        socket.once("error", reject)
        socket.once("data", chunk => resolve(chunk.toString()))
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: "read", method: "eth_chainId", params: [] }))
      })
      assert.deepEqual(JSON.parse(response), { jsonrpc: "2.0", id: "read", result: "0x2105" })
      socket.destroy()
      await runtime.close("SIGTERM")
      assert.equal(await runtime.finished, "release stopped before all approved steps completed")
      assert.match(await readFile(join(selected.auditDir, "approval.jsonl"), "utf8"), /release stopped before all approved steps completed/)
    } finally { await runtime.close("test cleanup") }
  } finally {
    await new Promise<void>(resolve => backend.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})

test("a signed transaction with mismatched calldata closes the gate after its RPC error", async () => {
  const root = await mkdtemp(join(tmpdir(), "approval-runtime-"))
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
  try {
    const reference = snapshot(account.address)
    const selected = settings(root, reference)
    await mkdir(join(root, "socket"), { mode: 0o700 })
    await mkdir(selected.auditDir, { mode: 0o700 })
    await writeFile(selected.referencePath, JSON.stringify(reference))
    const input = operatorInput()
    const output = operatorInput()
    const starting = startApprovalRuntime(selected, { input, output })
    await once(output, "data")
    input.write("start\n")
    const runtime = await starting
    try {
      const raw = await account.signTransaction({ type: "eip1559", chainId: 8453, nonce: 0,
        gas: 200_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, value: 0n, data: "0x60006001" })
      const socket = connect(selected.socketPath)
      const reply = await new Promise<string>((resolve, reject) => {
        socket.once("error", reject)
        socket.once("data", chunk => resolve(chunk.toString()))
        socket.write(JSON.stringify({ jsonrpc: "2.0", id: "write", method: "eth_sendRawTransaction", params: [raw] }))
      })
      assert.match(JSON.stringify(JSON.parse(reply)), /creation bytecode differs|inspection failed/i)
      socket.destroy()
      let timeout: NodeJS.Timeout | null = null
      let stopped: string
      try {
        stopped = await Promise.race([
          runtime.finished,
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("approval gate stayed open")), 3_000) }),
        ])
      } finally { if (timeout !== null) clearTimeout(timeout) }
      assert.match(stopped, /transaction inspection failed/)
      await assert.rejects(stat(selected.socketPath), { code: "ENOENT" })
      assert.match(await readFile(join(selected.auditDir, "approval.jsonl"), "utf8"), /transaction inspection failed/)
    } finally { await runtime.close("test cleanup") }
  } finally { await rm(root, { recursive: true, force: true }) }
})
