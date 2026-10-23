import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi, stringToHex } from "viem"
import type { Address } from "viem"
import { RELEASE_PLAN_SCHEMA, parseDeploymentArtifact } from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"

const execute = promisify(execFile)
const TOOL_DIR = dirname(fileURLToPath(import.meta.url))
const DEPLOYER = "0x0000000000000000000000000000000000000011"
const OWNER = "0x0000000000000000000000000000000000000012"
const ROOT = "0x0000000000000000000000000000000000000021"
const COMPONENTS = "0x0000000000000000000000000000000000000022"
const MANAGER = "0x0000000000000000000000000000000000000023"
const UI = "0x0000000000000000000000000000000000000024"
const ZERO = "0x0000000000000000000000000000000000000000"
const HASH = `0x${"ab".repeat(32)}` as const
const CREATED = [
  { contractName: "CamRoot", contractAddress: ROOT, hash: `0x${"21".repeat(32)}` },
  { contractName: "BicycleComponents", contractAddress: COMPONENTS, hash: `0x${"22".repeat(32)}` },
  { contractName: "BicycleComponentManager", contractAddress: MANAGER, hash: `0x${"23".repeat(32)}` },
  { contractName: "BicycleComponentManagerUI", contractAddress: UI, hash: `0x${"24".repeat(32)}` },
] as const
const ROLES = {
  MINTER_ROLE: keccak256(stringToHex("MINTER_ROLE")),
  TOKEN_URI_SETTER_ROLE: keccak256(stringToHex("TOKEN_URI_SETTER_ROLE")),
  PAUSER_ROLE: keccak256(stringToHex("PAUSER_ROLE")),
  CONFIGURER_ROLE: keccak256(stringToHex("CONFIGURER_ROLE")),
  REGISTRAR_ROLE: keccak256(stringToHex("REGISTRAR_ROLE")),
}
const ABI = parseAbi([
  "function camManifest() view returns ((string uri, bytes32 sha256Digest))",
  "function contractAddress(string name) view returns (address)",
  "function owner() view returns (address)", "function pendingOwner() view returns (address)",
  "function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address,uint48)",
  "function defaultAdminDelay() view returns (uint48)", "function pendingDefaultAdminDelay() view returns (uint48,uint48)",
  "function hasRole(bytes32 role,address account) view returns (bool)",
  "function name() view returns (string)", "function symbol() view returns (string)",
  "function baseURI() view returns (string)", "function contractURI() view returns (string)",
  "function paused() view returns (bool)",
  "function MINTER_ROLE() view returns (bytes32)", "function TOKEN_URI_SETTER_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)", "function CONFIGURER_ROLE() view returns (bytes32)",
  "function REGISTRAR_ROLE() view returns (bytes32)",
  "function componentsAddress() view returns (address)", "function manager() view returns (address)",
  "function maxDelegationDuration() view returns (uint48)", "function DEFAULT_MAX_DELEGATION_DURATION() view returns (uint48)",
])
const roleKey = (contract: string, role: string, account: string) => `${contract}:${role}:${account}`.toLowerCase()

test("Bike materializer accepts selected deployer authorities and rejects extra roles or substituted creation evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bike-release-rpc-"))
  const shared: ReleasePlan = {
    schema: RELEASE_PLAN_SCHEMA, sourceCommit: "0123456789abcdef0123456789abcdef01234567",
    expectedChainId: 11155111, camURI: "https://example.test/bike/cam/main.json", camHash: HASH,
    intendedCamRootOwner: DEPLOYER, tokenName: "Components", tokenSymbol: "BIKE", baseTokenURI: "",
    collectionURI: "data:application/json,%7B%22name%22%3A%22Components%22%7D",
    intendedComponentsAdmin: DEPLOYER, componentsAdminDelay: 86400,
    componentsPauser: DEPLOYER, componentsConfigurer: DEPLOYER,
    intendedManagerAdmin: DEPLOYER, managerAdminDelay: 172800,
    managerPauser: DEPLOYER, managerConfigurer: DEPLOYER, registrars: [DEPLOYER],
  }
  const mixed: ReleasePlan = {
    ...shared, intendedCamRootOwner: OWNER, intendedManagerAdmin: OWNER,
    componentsPauser: OWNER, managerConfigurer: OWNER, registrars: [DEPLOYER, OWNER],
  }
  const sharedHolders = [
    roleKey(COMPONENTS, ROLES.MINTER_ROLE, MANAGER), roleKey(COMPONENTS, ROLES.TOKEN_URI_SETTER_ROLE, MANAGER),
    roleKey(COMPONENTS, ROLES.PAUSER_ROLE, DEPLOYER), roleKey(COMPONENTS, ROLES.CONFIGURER_ROLE, DEPLOYER),
    roleKey(MANAGER, ROLES.PAUSER_ROLE, DEPLOYER), roleKey(MANAGER, ROLES.CONFIGURER_ROLE, DEPLOYER),
    roleKey(MANAGER, ROLES.REGISTRAR_ROLE, DEPLOYER),
  ]
  const mixedHolders = [
    roleKey(COMPONENTS, ROLES.MINTER_ROLE, MANAGER), roleKey(COMPONENTS, ROLES.TOKEN_URI_SETTER_ROLE, MANAGER),
    roleKey(COMPONENTS, ROLES.PAUSER_ROLE, OWNER), roleKey(COMPONENTS, ROLES.CONFIGURER_ROLE, DEPLOYER),
    roleKey(MANAGER, ROLES.PAUSER_ROLE, DEPLOYER), roleKey(MANAGER, ROLES.CONFIGURER_ROLE, OWNER),
    roleKey(MANAGER, ROLES.REGISTRAR_ROLE, DEPLOYER), roleKey(MANAGER, ROLES.REGISTRAR_ROLE, OWNER),
  ]
  let plan = shared
  let altered = "none"
  let holders = new Set<string>()
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
          const created = CREATED.find(entry => entry.hash === call.params[0])
          assert.ok(created)
          result = {
            transactionHash: altered === "receipt-hash" ? HASH : created.hash,
            blockHash: HASH, blockNumber: "0x1", transactionIndex: "0x0",
            from: altered === "receipt-sender" && created.contractAddress === UI ? OWNER : DEPLOYER,
            to: null, contractAddress: created.contractAddress,
            status: "0x1", type: "0x2", logs: [], cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1",
            logsBloom: `0x${"00".repeat(256)}`,
          }
          break
        }
        case "eth_call": {
          const transaction = call.params[0] as { to: Address; data: `0x${string}` }
          const to = transaction.to.toLowerCase()
          const decoded = decodeFunctionData({ abi: ABI, data: transaction.data })
          let observed: unknown
          switch (decoded.functionName) {
            case "camManifest": observed = { uri: plan.camURI, sha256Digest: HASH }; break
            case "contractAddress": {
              const created = CREATED.find(entry => entry.contractName === decoded.args[0])
              assert.ok(created)
              observed = created.contractAddress
              break
            }
            case "owner": observed = plan.intendedCamRootOwner; break
            case "pendingOwner": observed = altered === "self-pending" ? DEPLOYER : ZERO; break
            case "defaultAdmin": observed = to === COMPONENTS ? plan.intendedComponentsAdmin : plan.intendedManagerAdmin; break
            case "pendingDefaultAdmin": observed = [ZERO, 0]; break
            case "defaultAdminDelay": observed = to === COMPONENTS ? plan.componentsAdminDelay : plan.managerAdminDelay; break
            case "pendingDefaultAdminDelay": observed = [0, 0]; break
            case "hasRole": observed = holders.has(roleKey(to, decoded.args[0], decoded.args[1])); break
            case "name": observed = plan.tokenName; break
            case "symbol": observed = plan.tokenSymbol; break
            case "baseURI": observed = ""; break
            case "contractURI": observed = plan.collectionURI; break
            case "paused": observed = false; break
            case "MINTER_ROLE": case "TOKEN_URI_SETTER_ROLE": case "PAUSER_ROLE": case "CONFIGURER_ROLE": case "REGISTRAR_ROLE":
              observed = ROLES[decoded.functionName]; break
            case "componentsAddress": observed = COMPONENTS; break
            case "manager": observed = MANAGER; break
            case "maxDelegationDuration": case "DEFAULT_MAX_DELEGATION_DURATION": observed = 86400; break
          }
          result = encodeFunctionResult({ abi: ABI, functionName: decoded.functionName, result: observed as never })
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
    const broadcast = join(directory, "broadcast", "DeployBikeNftRelease.s.sol", "11155111")
    await mkdir(broadcast, { recursive: true })
    await writeFile(join(broadcast, "run-latest.json"), JSON.stringify({ transactions: CREATED.map(created => ({ transactionType: "CREATE", ...created })) }))
    const planPath = join(directory, "plan.json")
    for (const [label, selected, selectedHolders, diagnostic] of [
      ["shared", shared, sharedHolders, undefined],
      ["mixed", mixed, mixedHolders, undefined],
      ["extra-role", mixed, mixedHolders, /deployer components pauser role mismatch/],
      ["self-pending", shared, sharedHolders, /unexpected CamRoot ownership handoff/],
      ["receipt-hash", shared, sharedHolders, /receipt transaction hash does not match/],
      ["receipt-sender", shared, sharedHolders, /share one deployer/],
    ] as const) {
      plan = selected
      altered = label
      holders = new Set(selectedHolders)
      if (label === "extra-role") holders.add(roleKey(COMPONENTS, ROLES.PAUSER_ROLE, DEPLOYER))
      await writeFile(planPath, JSON.stringify(plan))
      const artifactPath = join(directory, `${label}.json`)
      const run = () => execute(process.execPath, ["--experimental-strip-types", join(TOOL_DIR, "artifact.ts")], {
        timeout: 15000,
        env: {
          ...process.env, BIKE_NFT_RELEASE_PLAN_PATH: planPath, BIKE_NFT_RELEASE_BROADCAST_DIR: join(directory, "broadcast"),
          BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH: artifactPath, BIKE_NFT_RELEASE_RPC_URL: `http://127.0.0.1:${address.port}`,
        },
      })
      if (diagnostic !== undefined) {
        await assert.rejects(run(), diagnostic)
        await assert.rejects(readFile(artifactPath), { code: "ENOENT" })
      } else {
        await run()
        const artifact = parseDeploymentArtifact(await readFile(artifactPath))
        assert.equal(artifact.deployer, DEPLOYER)
        assert.equal(artifact.camRoot, ROOT)
        assert.deepEqual([
          artifact.camRootCreationTransaction, artifact.componentsCreationTransaction,
          artifact.managerCreationTransaction, artifact.uiCreationTransaction,
        ], CREATED.map(created => created.hash))
        assert.equal(artifact.intendedComponentsAdmin, plan.intendedComponentsAdmin)
        assert.deepEqual(artifact.registrars, plan.registrars)
        assert.equal(artifact.baseTokenURI, "")
        assert.equal(artifact.collectionURI, plan.collectionURI)
      }
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
