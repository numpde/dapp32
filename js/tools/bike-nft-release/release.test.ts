import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Address, Hex } from "viem"
import { buildReleasePlan } from "./bundle.ts"
import { creationReceiptDeployer, deploymentContractsFromBroadcast, requireHandoff } from "./artifact-model.ts"
import { DEPLOYMENT_SCHEMA, parseDeploymentArtifact, releasePlanArguments, requiredAddresses, requiredDelay } from "./shared.ts"
import type { DeploymentArtifact } from "./shared.ts"

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex
const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const DEPLOYER = address("1"), OWNER = address("2"), COMPONENTS_ADMIN = address("3"), MANAGER_ADMIN = address("4")

test("Bike release inputs reject fixture-shaped authority", () => {
  assert.equal(requiredDelay("86400", "delay"), 86400)
  assert.throws(() => requiredDelay("0", "delay"), /positive uint48/)
  assert.deepEqual(requiredAddresses(`${address("5")},${address("6")}`, "registrars"), [address("5"), address("6")])
  assert.throws(() => requiredAddresses(`${address("5")},${address("5")}`, "registrars"), /duplicate/)
})

test("checked-in Bike CAM bytes produce a nonzero release hash", async () => {
  const plan = await buildReleasePlan({ ...common(), dappsRootPath: DAPPS, rootPath: join(DAPPS, "bike-nft/cam/main.json") })
  assert.match(plan.camHash, /^0x[0-9a-f]{64}$/)
  assert.doesNotMatch(plan.camHash, /^0x0{64}$/)
  assert.equal(releasePlanArguments(plan).split("\n").length, 20)
})

test("deployment artifact parsing rejects unknown fields and inconsistent authority", () => {
  const artifact = deployment()
  assert.deepEqual(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact))), artifact)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, extra: true }))), /unexpected=\[extra\]/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, managerCreationTransaction: artifact.uiCreationTransaction }))), /must be distinct/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, componentsPauser: DEPLOYER }))), /must not retain/)
})

test("broadcast and receipts bind four exact creations", () => {
  const contracts = deploymentContractsFromBroadcast({ transactions: [create("CamRoot", address("10"), hash("1")), create("BicycleComponents", address("11"), hash("2")), create("BicycleComponentManager", address("12"), hash("3")), create("BicycleComponentManagerUI", address("13"), hash("4"))] })
  assert.equal(contracts.manager.address, address("12"))
  assert.equal(creationReceiptDeployer(contracts.manager, { status: "success", contractAddress: contracts.manager.address, transactionHash: contracts.manager.transactionHash, from: DEPLOYER, to: null }, "manager"), DEPLOYER)
  assert.throws(() => creationReceiptDeployer(contracts.manager, { status: "success", contractAddress: contracts.ui.address, transactionHash: contracts.manager.transactionHash, from: DEPLOYER, to: null }, "manager"), /address mismatch/)
  assert.throws(() => deploymentContractsFromBroadcast({ transactions: [create("CamRoot", address("10"), hash("1")), create("BicycleComponents", address("11"), hash("2")), create("BicycleComponentManager", address("12"), hash("3")), create("BicycleComponentManagerUI", address("13"), hash("4")), { function: "registerComponent(address,string,string)" }] }), /must not register fixture components/)
})

test("handoff accepts only intended pending or completed state", () => {
  assert.doesNotThrow(() => requireHandoff("root", DEPLOYER, OWNER, DEPLOYER, OWNER))
  assert.doesNotThrow(() => requireHandoff("root", DEPLOYER, OWNER, OWNER, address("0")))
  assert.throws(() => requireHandoff("root", DEPLOYER, OWNER, DEPLOYER, address("0")), /unexpected root handoff/)
})

function common() { return { sourceCommit: SOURCE, expectedChainId: 11155111, camURI: "https://example.test/bike/v1/main.json", camRootOwner: OWNER, tokenName: "Bicycle Components", tokenSymbol: "BIKE", baseTokenURI: "https://example.test/bike/tokens/", collectionURI: "https://example.test/bike/collection.json", componentsAdmin: COMPONENTS_ADMIN, componentsAdminDelay: 86400, componentsPauser: address("5"), componentsConfigurer: address("6"), managerAdmin: MANAGER_ADMIN, managerAdminDelay: 86400, managerPauser: address("7"), managerConfigurer: address("8"), registrars: [address("9")] } as const }
function deployment(): DeploymentArtifact { const { expectedChainId, ...fields } = common(); return { ...fields, schema: DEPLOYMENT_SCHEMA, chainId: expectedChainId, deployer: DEPLOYER, camHash: hash("a"), camRoot: address("10"), components: address("11"), manager: address("12"), ui: address("13"), camRootCodeHash: hash("b"), componentsCodeHash: hash("c"), managerCodeHash: hash("d"), uiCodeHash: hash("e"), camRootCreationTransaction: hash("1"), componentsCreationTransaction: hash("2"), managerCreationTransaction: hash("3"), uiCreationTransaction: hash("4") } }
function create(contractName: string, contractAddress: string, transactionHash: string): unknown { return { transactionType: "CREATE", contractName, contractAddress, hash: transactionHash } }
