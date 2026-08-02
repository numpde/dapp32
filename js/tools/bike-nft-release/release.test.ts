import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Address, Hex } from "viem"
import { inspectReleaseCamBundle } from "../release-cam-bundle.ts"
import { deploymentArtifact, deploymentContractsFromBroadcast, requireHandoff } from "./artifact-model.ts"
import { DEPLOYMENT_SCHEMA, parseDeploymentArtifact, parseReleasePlan, RELEASE_PLAN_SCHEMA, requiredAddresses, requiredDelay } from "./shared.ts"
import type { DeploymentArtifact, ReleasePlan } from "./shared.ts"
import { creationReceiptDeployer } from "../release-provenance.ts"

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
  assert.throws(() => requiredAddresses(`${address("5")},${address("5")}`, "registrars"), /must be distinct/)
})

test("checked-in Bike CAM bytes reproduce the accepted release hash", async () => {
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath: DAPPS,
    rootPath: join(DAPPS, "bike-nft/cam/main.json"),
    camURI: "https://example.test/bike/v1/main.json",
    label: "Bike NFT",
  })
  assert.equal(bundle.camHash, CHECKED_IN_CAM_HASH)
})

test("Bike verification rejects source and CAM drift before snapshot publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "bike-verify-input-"))
  try {
    for (const [name, artifact, message] of [
      ["source", { ...verifiedDeployment(), sourceCommit: "f".repeat(40) }, /source commit mismatch/],
      ["cam", { ...verifiedDeployment(), camHash: hash("a") }, /CAM hash does not match/],
    ] as const) {
      const { result, snapshotPath } = runBikeVerifyInput(directory, name, artifact)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, message)
      assert.equal(existsSync(snapshotPath), false)
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("Bike verification applies the app parser before snapshot publication", () => {
  const directory = mkdtempSync(join(tmpdir(), "bike-verify-parser-"))
  try {
    const { registrars: _registrars, ...malformed } = verifiedDeployment()
    const { result, snapshotPath } = runBikeVerifyInput(directory, "malformed", malformed)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing=\[registrars\]/)
    assert.equal(existsSync(snapshotPath), false)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("Bike verification publishes one canonical no-clobber snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "bike-verify-success-"))
  try {
    const artifact = verifiedDeployment()
    const parsed = parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact)))
    const first = runBikeVerifyInput(directory, "success", artifact)
    assert.equal(first.result.status, 0, first.result.stderr)
    assert.equal(readFileSync(first.snapshotPath, "utf8"), `${JSON.stringify(parsed, null, 2)}\n`)
    assert.match(first.result.stdout, /"event":"bike_nft_release_input_verified"/)

    const second = runBikeVerifyInput(directory, "success", artifact)
    assert.notEqual(second.result.status, 0)
    assert.equal(readFileSync(second.snapshotPath, "utf8"), `${JSON.stringify(parsed, null, 2)}\n`)
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("deployment artifact parsing rejects unknown fields and inconsistent authority", () => {
  const artifact = deployment()
  assert.deepEqual(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact))), artifact)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, extra: true }))), /unexpected=\[extra\]/)
  const { registrars: _registrars, ...missingRegistrars } = artifact
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...missingRegistrars, extra: true }))),
    /Bike deployment artifact fields disagree: missing=\[registrars\] unexpected=\[extra\]/,
  )
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, managerCreationTransaction: artifact.uiCreationTransaction }))), /must be distinct/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, camRootCreationTransaction: hash("0") }))), /must not be zero/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, componentsPauser: DEPLOYER }))), /must not retain/)
})

test("Bike release parsing uses shared identity rules", () => {
  const plan = { ...common(), schema: RELEASE_PLAN_SCHEMA, camHash: hash("a") }
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, sourceCommit: "HEAD" }))),
    /40 lowercase hexadecimal/,
  )
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, expectedChainId: 31337 }))),
    /rejects local fixture chain ID/,
  )
  assert.throws(
    () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, intendedCamRootOwner: address("0") }))),
    /must not be the zero address/,
  )
})

test("release plans and deployment artifacts share the single-line text domain", () => {
  const plan = { ...common(), schema: RELEASE_PLAN_SCHEMA, camHash: hash("a") }
  const artifact = deployment()
  for (const field of ["tokenName", "tokenSymbol", "baseTokenURI", "collectionURI"] as const) {
    assert.throws(
      () => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, [field]: "line one\nline two" }))),
      new RegExp(`${field} must be a non-empty single-line string`),
    )
    assert.throws(
      () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, [field]: "line one\rline two" }))),
      new RegExp(`${field} must be a non-empty single-line string`),
    )
  }
})

test("the Bike planner rejects multiline release text before publishing a plan", () => {
  const directory = mkdtempSync(join(tmpdir(), "bike-release-plan-"))
  try {
    for (const [field, variable] of [
      ["tokenName", "BIKE_NFT_RELEASE_TOKEN_NAME"],
      ["tokenSymbol", "BIKE_NFT_RELEASE_TOKEN_SYMBOL"],
      ["baseTokenURI", "BIKE_NFT_RELEASE_BASE_TOKEN_URI"],
      ["collectionURI", "BIKE_NFT_RELEASE_COLLECTION_URI"],
    ] as const) {
      const planPath = join(directory, `${field}.json`)
      const result = spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "plan.ts")], {
        encoding: "utf8",
        env: { ...process.env, ...plannerEnv(planPath), [variable]: "line one\nline two" },
      })
      assert.notEqual(result.status, 0, `${field} unexpectedly produced a release plan`)
      assert.match(result.stderr, new RegExp(`${field} must be a non-empty single-line string`))
      assert.match(result.stderr, /\n\s+at /)
      assert.equal(existsSync(planPath), false)
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
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
function plannerEnv(planPath: string): NodeJS.ProcessEnv {
  const values = common()
  return {
    BIKE_NFT_RELEASE_SOURCE_COMMIT: values.sourceCommit, BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID: String(values.expectedChainId),
    BIKE_NFT_RELEASE_CAM_URI: values.camURI, BIKE_NFT_RELEASE_CAM_ROOT_PATH: join(DAPPS, "bike-nft/cam/main.json"), BIKE_NFT_RELEASE_DAPPS_ROOT: DAPPS,
    BIKE_NFT_RELEASE_PLAN_PATH: planPath, BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER: values.intendedCamRootOwner,
    BIKE_NFT_RELEASE_TOKEN_NAME: values.tokenName, BIKE_NFT_RELEASE_TOKEN_SYMBOL: values.tokenSymbol,
    BIKE_NFT_RELEASE_BASE_TOKEN_URI: values.baseTokenURI, BIKE_NFT_RELEASE_COLLECTION_URI: values.collectionURI,
    BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN: values.intendedComponentsAdmin, BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY: String(values.componentsAdminDelay),
    BIKE_NFT_RELEASE_COMPONENTS_PAUSER: values.componentsPauser, BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER: values.componentsConfigurer,
    BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN: values.intendedManagerAdmin, BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY: String(values.managerAdminDelay),
    BIKE_NFT_RELEASE_MANAGER_PAUSER: values.managerPauser, BIKE_NFT_RELEASE_MANAGER_CONFIGURER: values.managerConfigurer,
    BIKE_NFT_RELEASE_REGISTRARS: values.registrars.join(","),
  }
}
function deployment(): DeploymentArtifact { const { expectedChainId, ...fields } = common(); return { ...fields, schema: DEPLOYMENT_SCHEMA, chainId: expectedChainId, deployer: DEPLOYER, camHash: hash("a"), camRoot: address("10"), components: address("11"), manager: address("12"), ui: address("13"), camRootCodeHash: hash("b"), componentsCodeHash: hash("c"), managerCodeHash: hash("d"), uiCodeHash: hash("e"), camRootCreationTransaction: hash("1"), componentsCreationTransaction: hash("2"), managerCreationTransaction: hash("3"), uiCreationTransaction: hash("4") } }
function create(contractName: string, contractAddress: string, transactionHash: string): unknown { return { transactionType: "CREATE", contractName, contractAddress, hash: transactionHash } }

function verifiedDeployment(): DeploymentArtifact { return { ...deployment(), camHash: CHECKED_IN_CAM_HASH } }
function runBikeVerifyInput(directory: string, name: string, artifact: unknown) {
  const artifactPath = join(directory, `${name}-deployment.json`)
  const snapshotPath = join(directory, `${name}-verified.json`)
  writeFileSync(artifactPath, JSON.stringify(artifact))
  const result = spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "verify-input.ts")], {
    encoding: "utf8",
    env: {
      ...process.env,
      BIKE_NFT_DEPLOYMENT_ARTIFACT_PATH: artifactPath,
      BIKE_NFT_RELEASE_EXPECTED_SOURCE_COMMIT: SOURCE,
      BIKE_NFT_RELEASE_DAPPS_ROOT: DAPPS,
      BIKE_NFT_RELEASE_CAM_ROOT_PATH: join(DAPPS, "bike-nft/cam/main.json"),
      BIKE_NFT_VERIFIED_ARTIFACT_PATH: snapshotPath,
    },
  })
  return { result, snapshotPath }
}
