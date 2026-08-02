import { lstat, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem"
import type { Address, Hex } from "viem"
import type { Abi } from "viem"
import { creationReceiptDeployer, deploymentContractsFromBroadcast, requireHandoff } from "./artifact-model.ts"
import { DEPLOYMENT_SCHEMA, deploymentArguments, parseJsonRecord, parseReleasePlan, rejectDeployerAuthorities, releasePlanArguments, requiredEnv, writeNewJson, writeNewText } from "./shared.ts"
import type { DeploymentArtifact } from "./shared.ts"

const MAX_BYTES = 16 * 1024 * 1024
const ROOT_ABI = parseAbi(["function camURI() view returns (string)", "function camHash() view returns (bytes32)", "function contractAddress(string) view returns (address)", "function owner() view returns (address)", "function pendingOwner() view returns (address)"])
const ADMIN_ABI = parseAbi(["function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address,uint48)", "function defaultAdminDelay() view returns (uint48)", "function pendingDefaultAdminDelay() view returns (uint48,uint48)", "function hasRole(bytes32,address) view returns (bool)"])
const COMPONENTS_ABI = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function baseURI() view returns (string)", "function contractURI() view returns (string)", "function paused() view returns (bool)", "function MINTER_ROLE() view returns (bytes32)", "function TOKEN_URI_SETTER_ROLE() view returns (bytes32)", "function PAUSER_ROLE() view returns (bytes32)", "function CONFIGURER_ROLE() view returns (bytes32)", "function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address,uint48)", "function defaultAdminDelay() view returns (uint48)", "function pendingDefaultAdminDelay() view returns (uint48,uint48)", "function hasRole(bytes32,address) view returns (bool)"])
const MANAGER_ABI = parseAbi(["function componentsAddress() view returns (address)", "function paused() view returns (bool)", "function maxDelegationDuration() view returns (uint48)", "function DEFAULT_MAX_DELEGATION_DURATION() view returns (uint48)", "function REGISTRAR_ROLE() view returns (bytes32)", "function PAUSER_ROLE() view returns (bytes32)", "function CONFIGURER_ROLE() view returns (bytes32)", "function defaultAdmin() view returns (address)", "function pendingDefaultAdmin() view returns (address,uint48)", "function defaultAdminDelay() view returns (uint48)", "function pendingDefaultAdminDelay() view returns (uint48,uint48)", "function hasRole(bytes32,address) view returns (bool)"])
const UI_ABI = parseAbi(["function manager() view returns (address)"])

async function main(): Promise<void> {
  const env = process.env
  const plan = parseReleasePlan(await readRegularFile(requiredEnv(env, "BIKE_NFT_RELEASE_PLAN_PATH"), "release plan", MAX_BYTES))
  const planArguments = new TextDecoder().decode(await readRegularFile(requiredEnv(env, "BIKE_NFT_RELEASE_PLAN_ARGUMENTS_PATH"), "release plan arguments", MAX_BYTES))
  if (planArguments !== releasePlanArguments(plan)) throw new Error("release plan arguments do not exactly match release-plan.json")
  const broadcastPath = resolve(requiredEnv(env, "BIKE_NFT_RELEASE_BROADCAST_DIR"), "DeployBikeNftRelease.s.sol", String(plan.expectedChainId), "run-latest.json")
  const broadcast = parseJsonRecord(await readRegularFile(broadcastPath, "Forge broadcast", MAX_BYTES), "Forge broadcast")
  const contracts = deploymentContractsFromBroadcast(broadcast)
  const client = createPublicClient({ transport: http(requiredEnv(env, "BIKE_NFT_RELEASE_RPC_URL")) })
  const chainId = await client.getChainId()
  if (chainId !== plan.expectedChainId) throw new Error(`release RPC chain mismatch: expected ${plan.expectedChainId}, got ${chainId}`)
  const creations = [
    { label: "CamRoot", contract: contracts.camRoot },
    { label: "BicycleComponents", contract: contracts.components },
    { label: "BicycleComponentManager", contract: contracts.manager },
    { label: "BicycleComponentManagerUI", contract: contracts.ui },
  ] as const
  const receipts = await Promise.all(creations.map(({ contract }) => client.getTransactionReceipt({ hash: contract.transactionHash })))
  const deployers = receipts.map((receipt, index) => creationReceiptDeployer(creations[index]!.contract, receipt, creations[index]!.label))
  if (new Set(deployers.map((address) => address.toLowerCase())).size !== 1) throw new Error("release creation transactions do not share one deployer")
  const deployer = deployers[0]!
  rejectDeployerAuthorities({ ...plan, deployer })
  const blockNumber = await client.getBlockNumber()
  const code = await Promise.all(creations.map(({ contract, label }) => requiredCode(client.getCode({ address: contract.address, blockNumber }), label)))
  const read = <T>(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]) => client.readContract({ address, abi, functionName, args, blockNumber } as never) as Promise<T>
  const [camURI, camHash, managerBinding, uiBinding, rootOwner, rootPending, uiManager] = await Promise.all([
    read<string>(contracts.camRoot.address, ROOT_ABI, "camURI"), read<Hex>(contracts.camRoot.address, ROOT_ABI, "camHash"),
    read<Address>(contracts.camRoot.address, ROOT_ABI, "contractAddress", ["BicycleComponentManager"]), read<Address>(contracts.camRoot.address, ROOT_ABI, "contractAddress", ["BicycleComponentManagerUI"]),
    read<Address>(contracts.camRoot.address, ROOT_ABI, "owner"), read<Address>(contracts.camRoot.address, ROOT_ABI, "pendingOwner"), read<Address>(contracts.ui.address, UI_ABI, "manager"),
  ])
  assertEqual(camURI, plan.camURI, "CamRoot CAM URI"); assertEqual(camHash.toLowerCase(), plan.camHash.toLowerCase(), "CamRoot CAM hash")
  assertAddress(managerBinding, contracts.manager.address, "manager binding"); assertAddress(uiBinding, contracts.ui.address, "UI binding"); assertAddress(uiManager, contracts.manager.address, "UI manager")
  requireHandoff("CamRoot ownership", deployer, plan.camRootOwner, getAddress(rootOwner), getAddress(rootPending))

  const [componentsAdmin, componentsPending, componentsDelay, componentsPendingDelay, managerAdmin, managerPending, managerDelay, managerPendingDelay] = await Promise.all([
    read<Address>(contracts.components.address, ADMIN_ABI, "defaultAdmin"), read<readonly [Address, bigint]>(contracts.components.address, ADMIN_ABI, "pendingDefaultAdmin"), read<bigint>(contracts.components.address, ADMIN_ABI, "defaultAdminDelay"),
    read<readonly [bigint, bigint]>(contracts.components.address, ADMIN_ABI, "pendingDefaultAdminDelay"),
    read<Address>(contracts.manager.address, ADMIN_ABI, "defaultAdmin"), read<readonly [Address, bigint]>(contracts.manager.address, ADMIN_ABI, "pendingDefaultAdmin"), read<bigint>(contracts.manager.address, ADMIN_ABI, "defaultAdminDelay"), read<readonly [bigint, bigint]>(contracts.manager.address, ADMIN_ABI, "pendingDefaultAdminDelay"),
  ])
  requireHandoff("components admin", deployer, plan.componentsAdmin, getAddress(componentsAdmin), getAddress(componentsPending[0]))
  requireHandoff("manager admin", deployer, plan.managerAdmin, getAddress(managerAdmin), getAddress(managerPending[0]))
  assertEqual(String(componentsDelay), String(plan.componentsAdminDelay), "components admin delay"); assertEqual(String(managerDelay), String(plan.managerAdminDelay), "manager admin delay")
  if (componentsPendingDelay[0] !== 0n || componentsPendingDelay[1] !== 0n) throw new Error("components admin delay change must not be pending")
  if (managerPendingDelay[0] !== 0n || managerPendingDelay[1] !== 0n) throw new Error("manager admin delay change must not be pending")

  const [name, symbol, baseURI, collectionURI, componentsPaused, managerComponents, managerPaused, maxDelegationDuration, defaultMaxDelegationDuration, minterRole, setterRole, componentsPauserRole, componentsConfigurerRole, registrarRole, managerPauserRole, managerConfigurerRole] = await Promise.all([
    read<string>(contracts.components.address, COMPONENTS_ABI, "name"), read<string>(contracts.components.address, COMPONENTS_ABI, "symbol"), read<string>(contracts.components.address, COMPONENTS_ABI, "baseURI"), read<string>(contracts.components.address, COMPONENTS_ABI, "contractURI"), read<boolean>(contracts.components.address, COMPONENTS_ABI, "paused"),
    read<Address>(contracts.manager.address, MANAGER_ABI, "componentsAddress"), read<boolean>(contracts.manager.address, MANAGER_ABI, "paused"), read<bigint>(contracts.manager.address, MANAGER_ABI, "maxDelegationDuration"), read<bigint>(contracts.manager.address, MANAGER_ABI, "DEFAULT_MAX_DELEGATION_DURATION"),
    read<Hex>(contracts.components.address, COMPONENTS_ABI, "MINTER_ROLE"), read<Hex>(contracts.components.address, COMPONENTS_ABI, "TOKEN_URI_SETTER_ROLE"), read<Hex>(contracts.components.address, COMPONENTS_ABI, "PAUSER_ROLE"), read<Hex>(contracts.components.address, COMPONENTS_ABI, "CONFIGURER_ROLE"),
    read<Hex>(contracts.manager.address, MANAGER_ABI, "REGISTRAR_ROLE"), read<Hex>(contracts.manager.address, MANAGER_ABI, "PAUSER_ROLE"), read<Hex>(contracts.manager.address, MANAGER_ABI, "CONFIGURER_ROLE"),
  ])
  assertEqual(name, plan.tokenName, "token name"); assertEqual(symbol, plan.tokenSymbol, "token symbol"); assertEqual(baseURI, plan.baseTokenURI, "base token URI"); assertEqual(collectionURI, plan.collectionURI, "collection URI")
  if (componentsPaused || managerPaused) throw new Error("release contracts must be initially unpaused")
  if (maxDelegationDuration !== defaultMaxDelegationDuration) throw new Error("manager max delegation duration must retain its source default")
  assertAddress(managerComponents, contracts.components.address, "manager components")
  const roleChecks: readonly (readonly [Address, Abi, Hex, Address, boolean, string])[] = [
    [contracts.components.address, ADMIN_ABI, minterRole, contracts.manager.address, true, "manager minter"], [contracts.components.address, ADMIN_ABI, setterRole, contracts.manager.address, true, "manager URI setter"],
    [contracts.components.address, ADMIN_ABI, componentsPauserRole, plan.componentsPauser, true, "components pauser"], [contracts.components.address, ADMIN_ABI, componentsConfigurerRole, plan.componentsConfigurer, true, "components configurer"],
    [contracts.components.address, ADMIN_ABI, componentsPauserRole, deployer, false, "deployer components pauser"], [contracts.components.address, ADMIN_ABI, componentsConfigurerRole, deployer, false, "deployer components configurer"],
    [contracts.components.address, ADMIN_ABI, minterRole, deployer, false, "deployer components minter"], [contracts.components.address, ADMIN_ABI, setterRole, deployer, false, "deployer components URI setter"],
    [contracts.manager.address, ADMIN_ABI, managerPauserRole, plan.managerPauser, true, "manager pauser"], [contracts.manager.address, ADMIN_ABI, managerConfigurerRole, plan.managerConfigurer, true, "manager configurer"],
    [contracts.manager.address, ADMIN_ABI, managerPauserRole, deployer, false, "deployer manager pauser"], [contracts.manager.address, ADMIN_ABI, managerConfigurerRole, deployer, false, "deployer manager configurer"], [contracts.manager.address, ADMIN_ABI, registrarRole, deployer, false, "deployer registrar"],
    ...plan.registrars.map((registrar) => [contracts.manager.address, ADMIN_ABI, registrarRole, registrar, true, "registrar"] as const),
  ]
  await Promise.all(roleChecks.map(async ([address, abi, role, account, expected, label]) => { const actual = await read<boolean>(address, abi, "hasRole", [role, account]); if (actual !== expected) throw new Error(`${label} role mismatch`) }))
  const { schema: _planSchema, expectedChainId: _expectedChainId, ...planFields } = plan
  const deployment: DeploymentArtifact = { ...planFields, schema: DEPLOYMENT_SCHEMA, chainId, deployer, camRoot: contracts.camRoot.address, components: contracts.components.address, manager: contracts.manager.address, ui: contracts.ui.address, camRootCodeHash: keccak256(code[0]!), componentsCodeHash: keccak256(code[1]!), managerCodeHash: keccak256(code[2]!), uiCodeHash: keccak256(code[3]!), camRootCreationTransaction: contracts.camRoot.transactionHash, componentsCreationTransaction: contracts.components.transactionHash, managerCreationTransaction: contracts.manager.transactionHash, uiCreationTransaction: contracts.ui.transactionHash }
  const artifactPath = requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH"); const argsPath = requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARGUMENTS_PATH")
  await writeNewText(argsPath, deploymentArguments(deployment), "deployment arguments"); await writeNewJson(artifactPath, deployment, "deployment artifact")
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_deployment_artifact", blockNumber: blockNumber.toString(), artifactPath })}\n`)
}

async function requiredCode(value: Promise<Hex | undefined>, label: string): Promise<Hex> { const code = await value; if (code === undefined || code === "0x") throw new Error(`${label} has no deployed code`); return code }
function assertAddress(actual: Address, expected: Address, label: string): void { assertEqual(actual.toLowerCase(), expected.toLowerCase(), label) }
function assertEqual(actual: string, expected: string, label: string): void { if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`) }
async function readRegularFile(path: string, label: string, maximum: number): Promise<Uint8Array> { const stat = await lstat(path); if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${label} must be a regular non-symlink file: ${path}`); if (stat.size > maximum) throw new Error(`${label} exceeds ${maximum} bytes`); return new Uint8Array(await readFile(path)) }
main().catch((error: unknown) => {
  const message = error instanceof Error && error.stack !== undefined
    ? error.stack
    : error instanceof Error ? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
