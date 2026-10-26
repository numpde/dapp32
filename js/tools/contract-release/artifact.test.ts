import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { encodeAbiParameters, encodeDeployData, encodeFunctionData, getContractAddress, keccak256, parseAbi, parseTransaction, toHex, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { sha256, COMPILER_VERSION } from "../release-approval/reference-read.ts"
import { contractDeploymentReference } from "./reference.ts"
import type { ContractReleasePlan } from "./shared.ts"

test("business collection cannot include initialization mined after its observation block", async () => {
  const directory = await mkdtemp(join(tmpdir(), "business-artifact-anchor-"))
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`)
  const abi = parseAbi(["constructor(address initialAdmin,uint64 nullClaimPeriod)", "function transferOwnership(address newOwner)"])
  const plan: ContractReleasePlan = { schema: "cam.contract-release-plan.v1", app: "pay-to-play", sourceCommit: "a".repeat(40),
    expectedChainId: 31338, settings: { intendedPaymentAdmin: `0x${"22".repeat(20)}`, nullClaimPeriod: 86400 } }
  const planBytes = JSON.stringify(plan) + "\n"
  const expected = contractDeploymentReference(plan, account.address)
  const creationBytecode = "0x60006000" as const
  const created = getContractAddress({ from: account.address, nonce: 0n })
  const inputs = [encodeDeployData({ abi, bytecode: creationBytecode, args: [account.address, 86400n] }),
    encodeFunctionData({ abi, functionName: "transferOwnership", args: [plan.settings.intendedPaymentAdmin] })]
  const raw = await Promise.all(inputs.map((data, nonce) => account.signTransaction({ type: "eip1559", chainId: 31338,
    nonce, gas: 1000000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, value: 0n, data, ...(nonce === 0 ? {} : { to: created }) })))
  const hashes = raw.map(bytes => keccak256(bytes))
  const blockHash = (number: number) => `0x${number.toString(16).padStart(64, "0")}` as Hex
  const transactions = raw.map((bytes, index) => {
    const tx = parseTransaction(bytes)
    return { type: "0x2", chainId: "0x7a6a", hash: hashes[index], from: account.address, to: index === 0 ? null : created,
      input: inputs[index], nonce: toHex(index), gas: "0xf4240", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x1", value: "0x0",
      accessList: [], r: tx.r, s: tx.s, yParity: toHex(tx.yParity!), v: toHex(tx.yParity!),
      blockNumber: toHex(index === 0 ? 9 : 11), blockHash: blockHash(index === 0 ? 9 : 11), transactionIndex: "0x0" }
  })
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += chunk
    const rpc = JSON.parse(body)
    let result: unknown
    if (rpc.method === "eth_chainId") result = "0x7a6a"
    else if (rpc.method === "eth_blockNumber") result = "0xa"
    else if (rpc.method === "eth_getBlockByNumber") result = { number: rpc.params[0], hash: blockHash(Number(BigInt(rpc.params[0]))) }
    else if (rpc.method === "eth_getCode") result = "0x6000"
    else if (rpc.method === "eth_getTransactionByHash") result = transactions[hashes.indexOf(rpc.params[0])]
    else if (rpc.method === "eth_getTransactionReceipt") {
      const index = hashes.indexOf(rpc.params[0])
      result = { ...transactions[index], transactionHash: hashes[index], contractAddress: index === 0 ? created : null,
        status: "0x1", cumulativeGasUsed: "0x100", gasUsed: "0x100", effectiveGasPrice: "0x1", logs: [] }
    } else if (rpc.method === "eth_call") result = encodeAbiParameters([{ type: "address" }], [account.address])
    else throw new Error(`Unexpected fixture RPC method ${rpc.method}`)
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }))
  })
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert(address !== null && typeof address !== "string")
    const base = { schema: "release-approval.contract-reference.v1", app: "pay-to-play", ...expected, planSha256: sha256(planBytes),
      contracts: [{ role: "payments", name: "PayToPlay", source: "pay-to-play/src/PayToPlay.sol", compilerVersion: COMPILER_VERSION,
        compilerMetadataSha256: `0x${"33".repeat(32)}`, artifactSha256: `0x${"44".repeat(32)}`, creationBytecode, abi }] }
    await writeFile(join(directory, "plan.json"), planBytes)
    await writeFile(join(directory, "reference.json"), JSON.stringify({ ...base, snapshotSha256: sha256(JSON.stringify(base)) }))
    const broadcast = join(directory, "DeployContracts.s.sol", "31338")
    await mkdir(broadcast, { recursive: true })
    await writeFile(join(broadcast, "run-latest.json"), JSON.stringify({ transactions: hashes.map(hash => ({ hash })) }))
    const candidate = join(directory, "candidate.json")
    const child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./artifact.ts", import.meta.url))], {
      env: { ...process.env, CONTRACT_RELEASE_PLAN_PATH: join(directory, "plan.json"), CONTRACT_RELEASE_REFERENCE_PATH: join(directory, "reference.json"),
        CONTRACT_RELEASE_BROADCAST_DIR: directory, CONTRACT_RELEASE_CANDIDATE_PATH: candidate,
        CONTRACT_RELEASE_ARTIFACT_PATH: join(directory, "final.json"), CONTRACT_RELEASE_RPC_URL: `http://127.0.0.1:${address.port}` },
    })
    let stderr = ""
    child.stdout.resume()
    child.stderr.on("data", chunk => { stderr += chunk })
    const [status] = await once(child, "exit")
    assert.notEqual(status, 0)
    assert.match(stderr, /receipt block 11.*observation block 10/i)
    await assert.rejects(readFile(candidate), { code: "ENOENT" })
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
