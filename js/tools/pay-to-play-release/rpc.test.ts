import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"
import { keccak256 } from "viem"
import { DEPLOYMENT_SCHEMA, type DeploymentArtifact } from "./shared.ts"

const execute = promisify(execFile)
const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const ADMIN = "0x0000000000000000000000000000000000000011"
const OWNER = "0x0000000000000000000000000000000000000044"
const ROOT = "0x0000000000000000000000000000000000000022"
const PAYMENTS = "0x0000000000000000000000000000000000000033"
const UI = "0x0000000000000000000000000000000000000055"
const UI_TX = `0x${"56".repeat(32)}` as const
const ROOT_TX = `0x${"12".repeat(32)}` as const
const PAYMENT_TX = `0x${"34".repeat(32)}` as const
const HASH = `0x${"ab".repeat(32)}` as const
const INPUT = "0x60006000"

test("historical release verification rejects substituted creation evidence", async () => {
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
        case "eth_getTransactionReceipt": {
          const hash = call.params[0]
          result = {
            transactionHash: hash, blockHash: HASH, blockNumber: "0x1", transactionIndex: "0x0",
            from: ADMIN, to: null, contractAddress: hash === ROOT_TX ? ROOT : hash === PAYMENT_TX ? PAYMENTS : UI,
            status: altered === "receipt" ? "0x0" : "0x1", type: "0x2", logs: [],
            cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1",
            logsBloom: `0x${"00".repeat(256)}`,
          }
          break
        }
        case "eth_getTransactionByHash":
          result = {
            hash: altered === "hash" ? ROOT_TX : call.params[0],
            blockHash: HASH, blockNumber: "0x1", transactionIndex: "0x0", type: "0x2",
            from: altered === "sender" ? OWNER : ADMIN,
            to: altered === "destination" ? ROOT : null,
            input: altered === "input" || (altered === "uiInput" && call.params[0] === UI_TX) ? "0x6001" : INPUT,
            nonce: "0x1", value: "0x0", gas: "0x100000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x1",
            r: HASH, s: HASH, v: "0x1", chainId: "0xaa36a7", accessList: [],
          }
          break
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
    const artifact: DeploymentArtifact = {
      schema: DEPLOYMENT_SCHEMA, sourceCommit: "0123456789abcdef0123456789abcdef01234567",
      chainId: 11155111, camURI, camHash: HASH, intendedCamRootOwner: OWNER,
      intendedPaymentAdmin: ADMIN, nullClaimPeriod: 60, deployer: ADMIN,
      camRoot: ROOT, payToPlay: PAYMENTS, payToPlayUI: UI,
      camRootCodeHash: keccak256("0x6000"), payToPlayCodeHash: keccak256("0x6000"),
      payToPlayUICodeHash: keccak256("0x6000"), camRootCreationTransaction: ROOT_TX,
      payToPlayCreationTransaction: PAYMENT_TX, payToPlayCreationInputHash: keccak256(INPUT),
      payToPlayUICreationTransaction: UI_TX, payToPlayUICreationInputHash: keccak256(INPUT),
    }
    const artifactPath = join(dir, "deployment.json")
    await writeFile(artifactPath, JSON.stringify(artifact))
    const env = {
      ...process.env,
      PAY_TO_PLAY_DEPLOYMENT_ARTIFACT_PATH: artifactPath,
      PAY_TO_PLAY_RELEASE_RPC_URL: `http://127.0.0.1:${address.port}`,
    }
    const run = (script: string) => execute(process.execPath, ["--experimental-strip-types", join(TOOL_DIR, script)], { env, timeout: 15000 })
    await run("verify-provenance.ts")
    for (const [change, diagnostic] of [
      ["receipt", /did not succeed/], ["hash", /transaction hash mismatch/],
      ["sender", /sender mismatch/], ["destination", /destination address/],
      ["input", /creation input hash mismatch/], ["uiInput", /PayToPlayUI creation input hash mismatch/],
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
