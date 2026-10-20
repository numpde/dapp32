import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi } from "viem"
import { DEPLOYMENT_SCHEMA, RELEASE_PLAN_SCHEMA, parseDeploymentArtifact } from "./shared.ts"

const execute = promisify(execFile)
const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const ADMIN = "0x0000000000000000000000000000000000000011"
const OWNER = "0x0000000000000000000000000000000000000044"
const ROOT = "0x0000000000000000000000000000000000000022"
const PAYMENTS = "0x0000000000000000000000000000000000000033"
const ZERO = "0x0000000000000000000000000000000000000000"
const ROOT_TX = `0x${"12".repeat(32)}`
const PAYMENT_TX = `0x${"34".repeat(32)}`
const HASH = `0x${"ab".repeat(32)}` as const
const INPUT = "0x60006000"
const ABI = parseAbi([
  "function camManifest() view returns ((string uri, bytes32 sha256Digest))",
  "function contractAddress(string name) view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
])

test("release CLIs materialize RPC observations and reject substituted creation evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pay-to-play-release-rpc-"))
  let altered = "none"
  const camURI = "https://example.test/pay-to-play/cam/main.json"
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const call = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string; params: unknown[] }
      let result: unknown
      switch (call.method) {
        case "eth_chainId": result = "0xaa36a7"; break
        case "eth_blockNumber": result = "0x2"; break
        case "eth_getCode": result = "0x6000"; break
        case "eth_getTransactionReceipt": {
          const hash = call.params[0]
          result = {
            transactionHash: hash, blockHash: HASH, blockNumber: "0x1", transactionIndex: "0x0",
            from: ADMIN, to: null, contractAddress: hash === ROOT_TX ? ROOT : PAYMENTS,
            status: altered === "receipt" ? "0x0" : "0x1", type: "0x2", logs: [],
            cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1",
            logsBloom: `0x${"00".repeat(256)}`,
          }
          break
        }
        case "eth_getTransactionByHash":
          result = {
            hash: altered === "hash" ? ROOT_TX : PAYMENT_TX,
            blockHash: HASH, blockNumber: "0x1", transactionIndex: "0x0", type: "0x2",
            from: altered === "sender" ? OWNER : ADMIN,
            to: altered === "destination" ? ROOT : null,
            input: altered === "input" ? "0x6001" : INPUT,
            nonce: "0x1", value: "0x0", gas: "0x100000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x1",
            r: HASH, s: HASH, v: "0x1", chainId: "0xaa36a7", accessList: [],
          }
          break
        case "eth_call": {
          const transaction = call.params[0] as { to: string; data: `0x${string}` }
          const decoded = decodeFunctionData({ abi: ABI, data: transaction.data })
          switch (decoded.functionName) {
            case "camManifest":
              result = encodeFunctionResult({ abi: ABI, functionName: "camManifest", result: { uri: camURI, sha256Digest: HASH } })
              break
            case "contractAddress":
              result = encodeFunctionResult({ abi: ABI, functionName: "contractAddress", result: PAYMENTS })
              break
            case "owner":
              result = encodeFunctionResult({ abi: ABI, functionName: "owner", result: ADMIN })
              break
            case "pendingOwner":
              result = encodeFunctionResult({ abi: ABI, functionName: "pendingOwner", result: transaction.to.toLowerCase() === ROOT.toLowerCase() ? OWNER : ZERO })
              break
          }
          break
        }
        default: throw new Error(`unexpected RPC method: ${call.method}`)
      }
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, result }))
    })().catch((error: unknown) => {
      response.statusCode = 500
      response.end(String(error))
    })
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    assert.ok(address !== null && typeof address !== "string")
    const broadcast = join(dir, "broadcast", "DeployPayToPlayRelease.s.sol", "11155111")
    await mkdir(broadcast, { recursive: true })
    await writeFile(join(broadcast, "run-latest.json"), JSON.stringify({ transactions: [
      { transactionType: "CREATE", contractName: "CamRoot", contractAddress: ROOT, hash: ROOT_TX },
      { transactionType: "CREATE", contractName: "PayToPlay", contractAddress: PAYMENTS, hash: PAYMENT_TX },
    ] }))
    const planPath = join(dir, "plan.json")
    await writeFile(planPath, JSON.stringify({
      schema: RELEASE_PLAN_SCHEMA, sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      expectedChainId: 11155111, camURI, camHash: HASH, intendedCamRootOwner: OWNER,
      intendedPaymentAdmin: ADMIN, nullClaimPeriod: 60,
    }))
    const artifactPath = join(dir, "deployment.json")
    const env = {
      ...process.env, PAY_TO_PLAY_RELEASE_PLAN_PATH: planPath,
      PAY_TO_PLAY_RELEASE_BROADCAST_DIR: join(dir, "broadcast"),
      PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH: artifactPath,
      PAY_TO_PLAY_RELEASE_RPC_URL: `http://127.0.0.1:${address.port}`,
    }
    const run = (script: string) => execute(process.execPath, ["--experimental-strip-types", join(TOOL_DIR, script)], { env, timeout: 15000 })
    await run("artifact.ts")
    const artifact = parseDeploymentArtifact(await readFile(artifactPath))
    assert.equal(artifact.schema, DEPLOYMENT_SCHEMA)
    assert.equal(artifact.intendedCamRootOwner, OWNER)
    assert.equal(artifact.intendedPaymentAdmin, ADMIN)
    assert.equal(artifact.payToPlayCreationInputHash, keccak256(INPUT))
    await run("verify-provenance.ts")
    for (const [change, diagnostic] of [
      ["receipt", /did not succeed/], ["hash", /transaction hash mismatch/],
      ["sender", /sender mismatch/], ["destination", /destination address/],
      ["input", /creation input hash mismatch/],
    ] as const) {
      altered = change
      await assert.rejects(run("verify-provenance.ts"), diagnostic)
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await rm(dir, { recursive: true, force: true })
  }
})
