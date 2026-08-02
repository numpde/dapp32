import { resolve } from "node:path"

import { createPublicClient, getAddress, http, keccak256, parseAbi } from "viem"
import type { Abi, Address, Hex } from "viem"

import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { parseJsonRecord, requiredEnv, runReleaseTool } from "../release-values.ts"
import {
  deploymentArtifact,
  deploymentContractsFromBroadcast,
  requireHandoff,
} from "./artifact-model.ts"
import type { DeploymentContracts } from "./artifact-model.ts"
import { creationReceiptDeployer } from "../release-provenance.ts"
import {
  parseReleasePlan,
  rejectDeployerAuthorities,
} from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"

const MAX_BYTES = 16 * 1024 * 1024
const ROOT_ABI = parseAbi([
  "function camURI() view returns (string)",
  "function camHash() view returns (bytes32)",
  "function contractAddress(string) view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
])
const ADMIN_ABI = parseAbi([
  "function defaultAdmin() view returns (address)",
  "function pendingDefaultAdmin() view returns (address,uint48)",
  "function defaultAdminDelay() view returns (uint48)",
  "function pendingDefaultAdminDelay() view returns (uint48,uint48)",
  "function hasRole(bytes32,address) view returns (bool)",
])
const COMPONENTS_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function baseURI() view returns (string)",
  "function contractURI() view returns (string)",
  "function paused() view returns (bool)",
  "function MINTER_ROLE() view returns (bytes32)",
  "function TOKEN_URI_SETTER_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function CONFIGURER_ROLE() view returns (bytes32)",
])
const MANAGER_ABI = parseAbi([
  "function componentsAddress() view returns (address)",
  "function paused() view returns (bool)",
  "function maxDelegationDuration() view returns (uint48)",
  "function DEFAULT_MAX_DELEGATION_DURATION() view returns (uint48)",
  "function REGISTRAR_ROLE() view returns (bytes32)",
  "function PAUSER_ROLE() view returns (bytes32)",
  "function CONFIGURER_ROLE() view returns (bytes32)",
])
const UI_ABI = parseAbi(["function manager() view returns (address)"])

type ReleaseClient = ReturnType<typeof createPublicClient>
type ContractReader = <T>(
  address: Address,
  abi: Abi,
  functionName: string,
  args?: readonly unknown[],
) => Promise<T>

type RootObservation = {
  readonly camURI: string
  readonly camHash: Hex
  readonly managerBinding: Address
  readonly uiBinding: Address
  readonly owner: Address
  readonly pendingOwner: Address
}

type AdministrationObservation = {
  readonly admin: Address
  readonly pendingAdmin: Address
  readonly delay: bigint
  readonly pendingDelay: readonly [bigint, bigint]
}

type BikeConfigurationObservation = {
  readonly components: {
    readonly name: string
    readonly symbol: string
    readonly baseURI: string
    readonly collectionURI: string
    readonly paused: boolean
    readonly minterRole: Hex
    readonly setterRole: Hex
    readonly pauserRole: Hex
    readonly configurerRole: Hex
  }
  readonly manager: {
    readonly componentsAddress: Address
    readonly paused: boolean
    readonly maxDelegationDuration: bigint
    readonly defaultMaxDelegationDuration: bigint
    readonly registrarRole: Hex
    readonly pauserRole: Hex
    readonly configurerRole: Hex
  }
  readonly uiManager: Address
}

type RoleExpectation = {
  readonly contract: Address
  readonly role: Hex
  readonly account: Address
  readonly expected: boolean
  readonly label: string
}

async function main(): Promise<void> {
  const env = process.env
  const plan = parseReleasePlan(
    await readBoundedRegularFile(
      requiredEnv(env, "BIKE_NFT_RELEASE_PLAN_PATH"),
      "release plan",
      MAX_BYTES,
    ),
  )
  const broadcastPath = resolve(
    requiredEnv(env, "BIKE_NFT_RELEASE_BROADCAST_DIR"),
    "DeployBikeNftRelease.s.sol",
    String(plan.expectedChainId),
    "run-latest.json",
  )
  const broadcast = parseJsonRecord(
    await readBoundedRegularFile(broadcastPath, "Forge broadcast", MAX_BYTES),
    "Forge broadcast",
  )
  const contracts = deploymentContractsFromBroadcast(broadcast)
  const client = createPublicClient({
    transport: http(requiredEnv(env, "BIKE_NFT_RELEASE_RPC_URL")),
  })

  const chainId = await client.getChainId()
  if (chainId !== plan.expectedChainId) {
    throw new Error(`release RPC chain mismatch: expected ${plan.expectedChainId}, got ${chainId}`)
  }
  const deployer = await proveCreationProvenance(client, contracts)
  rejectDeployerAuthorities({ ...plan, deployer })

  const blockNumber = await client.getBlockNumber()
  const read: ContractReader = <T>(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]) => client.readContract({
    address,
    abi,
    functionName,
    args,
    blockNumber,
  } as never) as Promise<T>

  const code = await observeCode(client, contracts, blockNumber)
  const root = await observeRoot(read, contracts.camRoot.address)
  verifyRoot(plan, contracts, deployer, root)

  const administrations = await observeAdministrations(read, contracts)
  verifyAdministrations(plan, deployer, administrations)

  const configuration = await observeBikeConfiguration(read, contracts)
  verifyBikeConfiguration(plan, contracts, configuration)
  await verifyRolePolicy(read, plan, contracts, deployer, configuration)

  const deployment = deploymentArtifact(plan, {
    chainId,
    deployer,
    contracts,
    codeHashes: {
      camRoot: keccak256(code.camRoot),
      components: keccak256(code.components),
      manager: keccak256(code.manager),
      ui: keccak256(code.ui),
    },
  })
  const artifactPath = requiredEnv(env, "BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH")
  await writeNewJson(artifactPath, deployment, "deployment artifact")
  process.stdout.write(`${JSON.stringify({
    event: "bike_nft_deployment_artifact",
    blockNumber: blockNumber.toString(),
    artifactPath,
  })}\n`)
}

async function proveCreationProvenance(
  client: ReleaseClient,
  contracts: DeploymentContracts,
): Promise<Address> {
  const [camRootReceipt, componentsReceipt, managerReceipt, uiReceipt] = await Promise.all([
    client.getTransactionReceipt({ hash: contracts.camRoot.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.components.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.manager.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.ui.transactionHash }),
  ])
  const camRoot = creationReceiptDeployer(contracts.camRoot, camRootReceipt, "CamRoot")
  const components = creationReceiptDeployer(
    contracts.components,
    componentsReceipt,
    "BicycleComponents",
  )
  const manager = creationReceiptDeployer(
    contracts.manager,
    managerReceipt,
    "BicycleComponentManager",
  )
  const ui = creationReceiptDeployer(contracts.ui, uiReceipt, "BicycleComponentManagerUI")
  const deployers = [camRoot, components, manager, ui]
  if (new Set(deployers.map((address) => address.toLowerCase())).size !== 1) {
    throw new Error("release creation transactions do not share one deployer")
  }
  return camRoot
}

async function observeCode(
  client: ReleaseClient,
  contracts: DeploymentContracts,
  blockNumber: bigint,
): Promise<{ readonly camRoot: Hex; readonly components: Hex; readonly manager: Hex; readonly ui: Hex }> {
  const [camRoot, components, manager, ui] = await Promise.all([
    client.getCode({ address: contracts.camRoot.address, blockNumber }),
    client.getCode({ address: contracts.components.address, blockNumber }),
    client.getCode({ address: contracts.manager.address, blockNumber }),
    client.getCode({ address: contracts.ui.address, blockNumber }),
  ])
  return {
    camRoot: requiredCode(camRoot, "CamRoot"),
    components: requiredCode(components, "BicycleComponents"),
    manager: requiredCode(manager, "BicycleComponentManager"),
    ui: requiredCode(ui, "BicycleComponentManagerUI"),
  }
}

async function observeRoot(read: ContractReader, address: Address): Promise<RootObservation> {
  const [camURI, camHash, managerBinding, uiBinding, owner, pendingOwner] = await Promise.all([
    read<string>(address, ROOT_ABI, "camURI"),
    read<Hex>(address, ROOT_ABI, "camHash"),
    read<Address>(address, ROOT_ABI, "contractAddress", ["BicycleComponentManager"]),
    read<Address>(address, ROOT_ABI, "contractAddress", ["BicycleComponentManagerUI"]),
    read<Address>(address, ROOT_ABI, "owner"),
    read<Address>(address, ROOT_ABI, "pendingOwner"),
  ])
  return {
    camURI,
    camHash,
    managerBinding,
    uiBinding,
    owner,
    pendingOwner,
  }
}

async function observeAdministrations(
  read: ContractReader,
  contracts: DeploymentContracts,
): Promise<{ readonly components: AdministrationObservation; readonly manager: AdministrationObservation }> {
  const [components, manager] = await Promise.all([
    observeAdministration(read, contracts.components.address),
    observeAdministration(read, contracts.manager.address),
  ])
  return { components, manager }
}

async function observeAdministration(
  read: ContractReader,
  address: Address,
): Promise<AdministrationObservation> {
  const [admin, pendingAdmin, delay, pendingDelay] = await Promise.all([
    read<Address>(address, ADMIN_ABI, "defaultAdmin"),
    read<readonly [Address, bigint]>(address, ADMIN_ABI, "pendingDefaultAdmin"),
    read<bigint>(address, ADMIN_ABI, "defaultAdminDelay"),
    read<readonly [bigint, bigint]>(address, ADMIN_ABI, "pendingDefaultAdminDelay"),
  ])
  return {
    admin,
    pendingAdmin: pendingAdmin[0],
    delay,
    pendingDelay,
  }
}

async function observeBikeConfiguration(
  read: ContractReader,
  contracts: DeploymentContracts,
): Promise<BikeConfigurationObservation> {
  const [components, manager, uiManager] = await Promise.all([
    observeComponents(read, contracts.components.address),
    observeManager(read, contracts.manager.address),
    read<Address>(contracts.ui.address, UI_ABI, "manager"),
  ])
  return { components, manager, uiManager }
}

async function observeComponents(
  read: ContractReader,
  address: Address,
): Promise<BikeConfigurationObservation["components"]> {
  const [name, symbol, baseURI, collectionURI, paused, minterRole, setterRole, pauserRole, configurerRole] = await Promise.all([
    read<string>(address, COMPONENTS_ABI, "name"),
    read<string>(address, COMPONENTS_ABI, "symbol"),
    read<string>(address, COMPONENTS_ABI, "baseURI"),
    read<string>(address, COMPONENTS_ABI, "contractURI"),
    read<boolean>(address, COMPONENTS_ABI, "paused"),
    read<Hex>(address, COMPONENTS_ABI, "MINTER_ROLE"),
    read<Hex>(address, COMPONENTS_ABI, "TOKEN_URI_SETTER_ROLE"),
    read<Hex>(address, COMPONENTS_ABI, "PAUSER_ROLE"),
    read<Hex>(address, COMPONENTS_ABI, "CONFIGURER_ROLE"),
  ])
  return {
    name,
    symbol,
    baseURI,
    collectionURI,
    paused,
    minterRole,
    setterRole,
    pauserRole,
    configurerRole,
  }
}

async function observeManager(
  read: ContractReader,
  address: Address,
): Promise<BikeConfigurationObservation["manager"]> {
  const [componentsAddress, paused, maxDelegationDuration, defaultMaxDelegationDuration, registrarRole, pauserRole, configurerRole] = await Promise.all([
    read<Address>(address, MANAGER_ABI, "componentsAddress"),
    read<boolean>(address, MANAGER_ABI, "paused"),
    read<bigint>(address, MANAGER_ABI, "maxDelegationDuration"),
    read<bigint>(address, MANAGER_ABI, "DEFAULT_MAX_DELEGATION_DURATION"),
    read<Hex>(address, MANAGER_ABI, "REGISTRAR_ROLE"),
    read<Hex>(address, MANAGER_ABI, "PAUSER_ROLE"),
    read<Hex>(address, MANAGER_ABI, "CONFIGURER_ROLE"),
  ])
  return {
    componentsAddress,
    paused,
    maxDelegationDuration,
    defaultMaxDelegationDuration,
    registrarRole,
    pauserRole,
    configurerRole,
  }
}

function verifyRoot(
  plan: ReleasePlan,
  contracts: DeploymentContracts,
  deployer: Address,
  root: RootObservation,
): void {
  assertEqual(root.camURI, plan.camURI, "CamRoot CAM URI")
  assertEqual(root.camHash.toLowerCase(), plan.camHash.toLowerCase(), "CamRoot CAM hash")
  assertAddress(root.managerBinding, contracts.manager.address, "manager binding")
  assertAddress(root.uiBinding, contracts.ui.address, "UI binding")
  requireHandoff(
    "CamRoot ownership",
    deployer,
    plan.intendedCamRootOwner,
    getAddress(root.owner),
    getAddress(root.pendingOwner),
  )
}

function verifyAdministrations(
  plan: ReleasePlan,
  deployer: Address,
  administrations: {
    readonly components: AdministrationObservation
    readonly manager: AdministrationObservation
  },
): void {
  requireHandoff(
    "components admin",
    deployer,
    plan.intendedComponentsAdmin,
    getAddress(administrations.components.admin),
    getAddress(administrations.components.pendingAdmin),
  )
  requireHandoff(
    "manager admin",
    deployer,
    plan.intendedManagerAdmin,
    getAddress(administrations.manager.admin),
    getAddress(administrations.manager.pendingAdmin),
  )
  assertEqual(
    String(administrations.components.delay),
    String(plan.componentsAdminDelay),
    "components admin delay",
  )
  assertEqual(
    String(administrations.manager.delay),
    String(plan.managerAdminDelay),
    "manager admin delay",
  )
  requireNoPendingDelay("components", administrations.components.pendingDelay)
  requireNoPendingDelay("manager", administrations.manager.pendingDelay)
}

function verifyBikeConfiguration(
  plan: ReleasePlan,
  contracts: DeploymentContracts,
  configuration: BikeConfigurationObservation,
): void {
  assertEqual(configuration.components.name, plan.tokenName, "token name")
  assertEqual(configuration.components.symbol, plan.tokenSymbol, "token symbol")
  assertEqual(configuration.components.baseURI, plan.baseTokenURI, "base token URI")
  assertEqual(configuration.components.collectionURI, plan.collectionURI, "collection URI")
  if (configuration.components.paused || configuration.manager.paused) {
    throw new Error("release contracts must be initially unpaused")
  }
  if (
    configuration.manager.maxDelegationDuration
    !== configuration.manager.defaultMaxDelegationDuration
  ) {
    throw new Error("manager max delegation duration must retain its source default")
  }
  assertAddress(
    configuration.manager.componentsAddress,
    contracts.components.address,
    "manager components",
  )
  assertAddress(configuration.uiManager, contracts.manager.address, "UI manager")
}

async function verifyRolePolicy(
  read: ContractReader,
  plan: ReleasePlan,
  contracts: DeploymentContracts,
  deployer: Address,
  configuration: BikeConfigurationObservation,
): Promise<void> {
  const expectations: readonly RoleExpectation[] = [
    roleExpectation(contracts.components.address, configuration.components.minterRole, contracts.manager.address, true, "manager minter"),
    roleExpectation(contracts.components.address, configuration.components.setterRole, contracts.manager.address, true, "manager URI setter"),
    roleExpectation(contracts.components.address, configuration.components.pauserRole, plan.componentsPauser, true, "components pauser"),
    roleExpectation(contracts.components.address, configuration.components.configurerRole, plan.componentsConfigurer, true, "components configurer"),
    roleExpectation(contracts.components.address, configuration.components.pauserRole, deployer, false, "deployer components pauser"),
    roleExpectation(contracts.components.address, configuration.components.configurerRole, deployer, false, "deployer components configurer"),
    roleExpectation(contracts.components.address, configuration.components.minterRole, deployer, false, "deployer components minter"),
    roleExpectation(contracts.components.address, configuration.components.setterRole, deployer, false, "deployer components URI setter"),
    roleExpectation(contracts.manager.address, configuration.manager.pauserRole, plan.managerPauser, true, "manager pauser"),
    roleExpectation(contracts.manager.address, configuration.manager.configurerRole, plan.managerConfigurer, true, "manager configurer"),
    roleExpectation(contracts.manager.address, configuration.manager.pauserRole, deployer, false, "deployer manager pauser"),
    roleExpectation(contracts.manager.address, configuration.manager.configurerRole, deployer, false, "deployer manager configurer"),
    roleExpectation(contracts.manager.address, configuration.manager.registrarRole, deployer, false, "deployer registrar"),
    ...plan.registrars.map((registrar) => roleExpectation(
      contracts.manager.address,
      configuration.manager.registrarRole,
      registrar,
      true,
      "registrar",
    )),
  ]
  await Promise.all(expectations.map(async (expectation) => {
    const actual = await read<boolean>(
      expectation.contract,
      ADMIN_ABI,
      "hasRole",
      [expectation.role, expectation.account],
    )
    if (actual !== expectation.expected) {
      throw new Error(`${expectation.label} role mismatch`)
    }
  }))
}

function roleExpectation(
  contract: Address,
  role: Hex,
  account: Address,
  expected: boolean,
  label: string,
): RoleExpectation {
  return { contract, role, account, expected, label }
}

function requireNoPendingDelay(label: string, pendingDelay: readonly [bigint, bigint]): void {
  if (pendingDelay[0] !== 0n || pendingDelay[1] !== 0n) {
    throw new Error(`${label} admin delay change must not be pending`)
  }
}

function requiredCode(code: Hex | undefined, label: string): Hex {
  if (code === undefined || code === "0x") throw new Error(`${label} has no deployed code`)
  return code
}

function assertAddress(actual: Address, expected: Address, label: string): void {
  assertEqual(actual.toLowerCase(), expected.toLowerCase(), label)
}

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`)
}

runReleaseTool(main)
