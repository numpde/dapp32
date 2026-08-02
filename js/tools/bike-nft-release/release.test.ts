import assert from "node:assert/strict"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Address, Hex } from "viem"
import { inspectReleaseBundle } from "./bundle.ts"
import { creationReceiptDeployer, deploymentArtifact, deploymentContractsFromBroadcast, requireHandoff } from "./artifact-model.ts"
import { DEPLOYMENT_SCHEMA, parseDeploymentArtifact, RELEASE_PLAN_SCHEMA, requiredAddresses, requiredDelay } from "./shared.ts"
import type { DeploymentArtifact, ReleasePlan } from "./shared.ts"

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex
const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const CHECKED_IN_CAM_HASH = "0x57fa120882de1530d9b48f00e8d3e780edd42c2159378b69ce86996bfb279961"
const DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const DEPLOYER = address("1"), OWNER = address("2"), COMPONENTS_ADMIN = address("3"), MANAGER_ADMIN = address("4")

test("Bike release inputs reject fixture-shaped authority", () => {
  assert.equal(requiredDelay("86400", "delay"), 86400)
  assert.throws(() => requiredDelay("0", "delay"), /positive uint48/)
  assert.deepEqual(requiredAddresses(`${address("5")},${address("6")}`, "registrars"), [address("5"), address("6")])
  assert.throws(() => requiredAddresses(`${address("5")},${address("5")}`, "registrars"), /duplicate/)
})

test("checked-in Bike CAM bytes reproduce the accepted release hash", async () => {
  const bundle = await inspectReleaseBundle({
    dappsRootPath: DAPPS,
    rootPath: join(DAPPS, "bike-nft/cam/main.json"),
    camURI: "https://example.test/bike/v1/main.json",
  })
  assert.equal(bundle.camHash, CHECKED_IN_CAM_HASH)
})

test("deployment artifact parsing rejects unknown fields and inconsistent authority", () => {
  const artifact = deployment()
  assert.deepEqual(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact))), artifact)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, extra: true }))), /unexpected=\[extra\]/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, managerCreationTransaction: artifact.uiCreationTransaction }))), /must be distinct/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, componentsPauser: DEPLOYER }))), /must not retain/)
})

test("deployment artifact projection preserves named contract evidence", () => {
  const contracts = deploymentContractsFromBroadcast({ transactions: [
    create("CamRoot", address("10"), hash("1")),
    create("BicycleComponents", address("11"), hash("2")),
    create("BicycleComponentManager", address("12"), hash("3")),
    create("BicycleComponentManagerUI", address("13"), hash("4")),
  ] })
  const plan: ReleasePlan = {
    ...common(),
    schema: RELEASE_PLAN_SCHEMA,
    camHash: hash("a"),
  }

  assert.deepEqual(deploymentArtifact(plan, {
    chainId: plan.expectedChainId,
    deployer: DEPLOYER,
    contracts,
    codeHashes: {
      camRoot: hash("b"),
      components: hash("c"),
      manager: hash("d"),
      ui: hash("e"),
    },
  }), deployment())
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

function common() { return { sourceCommit: SOURCE, expectedChainId: 11155111, camURI: "https://example.test/bike/v1/main.json", intendedCamRootOwner: OWNER, tokenName: "Bicycle Components", tokenSymbol: "BIKE", baseTokenURI: "https://example.test/bike/tokens/", collectionURI: "https://example.test/bike/collection.json", intendedComponentsAdmin: COMPONENTS_ADMIN, componentsAdminDelay: 86400, componentsPauser: address("5"), componentsConfigurer: address("6"), intendedManagerAdmin: MANAGER_ADMIN, managerAdminDelay: 86400, managerPauser: address("7"), managerConfigurer: address("8"), registrars: [address("9")] } as const }
function deployment(): DeploymentArtifact { const { expectedChainId, ...fields } = common(); return { ...fields, schema: DEPLOYMENT_SCHEMA, chainId: expectedChainId, deployer: DEPLOYER, camHash: hash("a"), camRoot: address("10"), components: address("11"), manager: address("12"), ui: address("13"), camRootCodeHash: hash("b"), componentsCodeHash: hash("c"), managerCodeHash: hash("d"), uiCodeHash: hash("e"), camRootCreationTransaction: hash("1"), componentsCreationTransaction: hash("2"), managerCreationTransaction: hash("3"), uiCreationTransaction: hash("4") } }
function create(contractName: string, contractAddress: string, transactionHash: string): unknown { return { transactionType: "CREATE", contractName, contractAddress, hash: transactionHash } }
