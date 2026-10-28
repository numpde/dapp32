import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Address, Hex } from "viem"
import { inspectReleaseCamBundle } from "../release-cam-bundle.ts"
import { backingFromDeployment } from "../ui-release/shared.ts"


import { ownershipState } from "../release-ownership.ts"
import { DEPLOYMENT_SCHEMA, parseDeploymentArtifact, parseReleasePlan, RELEASE_PLAN_SCHEMA, requiredAddresses, requiredDelay } from "./shared.ts"
import type { DeploymentArtifact } from "./shared.ts"

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex
const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const CHECKED_IN_CAM_HASH = `0x${createHash("sha256").update(readFileSync(join(DAPPS, "bike-nft/cam/main.json"))).digest("hex")}` as Hex
const DEPLOYER = address("1"), OWNER = address("2"), COMPONENTS_ADMIN = address("3"), MANAGER_ADMIN = address("4")

test("Bike release parsing rejects the old Keccak commitment schemas", () => {
  assert.throws(() => parseReleasePlan(new TextEncoder().encode(JSON.stringify({
    ...common(), camHash: hash("a"), schema: "bike-nft.release-plan.v1",
  }))), /unsupported release plan schema/)
  assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({
    ...deployment(), schema: "bike-nft.deployment.v1",
  }))), /unsupported deployment artifact schema/)
})

test("Bike release inputs reject fixture-shaped authority", () => {
  assert.equal(requiredDelay("86400", "delay"), 86400)
  assert.throws(() => requiredDelay("0", "delay"), /positive uint48/)
  assert.deepEqual(requiredAddresses(`${address("5")},${address("6")}`, "registrars"), [address("5"), address("6")])
  assert.throws(() => requiredAddresses(`${address("5")},${address("5")}`, "registrars"), /must be distinct/)
})

test("Bike release inspection reports SHA-256 of the exact checked-in manifest bytes", async () => {
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

test("deployment artifact parsing rejects malformed evidence and preserves selected deployer authority", () => {
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
  assert.equal(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, componentsPauser: DEPLOYER }))).componentsPauser, DEPLOYER)
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
      new RegExp(`${field} must be a .*single-line string`),
    )
    assert.throws(
      () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, [field]: "line one\rline two" }))),
      new RegExp(`${field} must be a .*single-line string`),
    )
  }
})

test("Bike release keeps an explicitly empty metadata base in plans, artifacts and verification", () => {
  const plan = { ...common(), schema: RELEASE_PLAN_SCHEMA, camHash: hash("a"), baseTokenURI: "" }
  assert.equal(parseReleasePlan(new TextEncoder().encode(JSON.stringify(plan))).baseTokenURI, "")
  const artifact = { ...verifiedDeployment(), baseTokenURI: "" }
  assert.equal(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact))).baseTokenURI, "")
  const directory = mkdtempSync(join(tmpdir(), "bike-release-empty-base-"))
  try {
    const planPath = join(directory, "plan.json")
    const env = { ...process.env, ...plannerEnv(planPath), BIKE_NFT_RELEASE_BASE_TOKEN_URI: "" }
    const result = spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "plan.ts")], { encoding: "utf8", env })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(parseReleasePlan(new TextEncoder().encode(readFileSync(planPath, "utf8"))).baseTokenURI, "")
    const verified = runBikeVerifyInput(directory, "empty-base", artifact)
    assert.equal(verified.result.status, 0, verified.result.stderr)
    assert.equal(parseDeploymentArtifact(new TextEncoder().encode(readFileSync(verified.snapshotPath, "utf8"))).baseTokenURI, "")
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("Bike release requires a present string metadata base and keeps other metadata mandatory", () => {
  const plan = { ...common(), schema: RELEASE_PLAN_SCHEMA, camHash: hash("a") }
  for (const invalid of [undefined, null, 0, "line\nbreak", "line\rbreak"]) {
    assert.throws(() => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, baseTokenURI: invalid }))), /baseTokenURI/)
    assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...deployment(), baseTokenURI: invalid }))), /baseTokenURI/)
  }
  for (const field of ["tokenName", "tokenSymbol", "collectionURI"] as const) {
    assert.throws(() => parseReleasePlan(new TextEncoder().encode(JSON.stringify({ ...plan, [field]: "" }))), new RegExp(field))
  }
  const directory = mkdtempSync(join(tmpdir(), "bike-release-missing-base-"))
  try {
    const planPath = join(directory, "plan.json")
    const env: NodeJS.ProcessEnv = { ...process.env, ...plannerEnv(planPath) }
    delete env.BIKE_NFT_RELEASE_BASE_TOKEN_URI
    const result = spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "plan.ts")], { encoding: "utf8", env })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /baseTokenURI|BIKE_NFT_RELEASE_BASE_TOKEN_URI/)
    assert.equal(existsSync(planPath), false)
  } finally {
    rmSync(directory, { recursive: true })
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
      assert.match(result.stderr, new RegExp(`${field} must be a .*single-line string`))
      assert.match(result.stderr, /\n\s+at /)
      assert.equal(existsSync(planPath), false)
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("the Bike planner rejects a missing or empty CAM URI before publishing a plan", () => {
  const directory = mkdtempSync(join(tmpdir(), "bike-release-cam-uri-"))
  try {
    for (const camURI of [undefined, ""] as const) {
      const planPath = join(directory, camURI === undefined ? "missing.json" : "empty.json")
      const env = { ...process.env, ...plannerEnv(planPath) }
      if (camURI === undefined) {
        delete env.BIKE_NFT_RELEASE_CAM_URI
      } else {
        env.BIKE_NFT_RELEASE_CAM_URI = camURI
      }

      const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), "plan.ts")],
        { encoding: "utf8", env },
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /missing required environment variable: BIKE_NFT_RELEASE_CAM_URI/)
      assert.equal(existsSync(planPath), false)
    }
  } finally {
    rmSync(directory, { recursive: true })
  }
})

test("handoff accepts only intended pending or completed state", () => {
  for (const [intendedOwner, owner, pendingOwner] of [
    [OWNER, DEPLOYER, OWNER],
    [OWNER, OWNER, address("0")],
    [DEPLOYER, DEPLOYER, address("0")],
  ] as const) {
    assert.doesNotThrow(() => ownershipState({ label: "root", deployer: DEPLOYER, intendedOwner, owner, pendingOwner }))
  }
  for (const [intendedOwner, pendingOwner] of [[DEPLOYER, DEPLOYER], [OWNER, address("0")]] as const) {
    assert.throws(() => ownershipState({ label: "root", deployer: DEPLOYER, intendedOwner, owner: DEPLOYER, pendingOwner }), /unexpected root handoff/)
  }
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


test("UI deployment selects the historical manager rather than the collection, UI or CAM root", () => {
  const artifact = deployment()
  const bytes = new TextEncoder().encode(JSON.stringify(artifact, null, 2))
  const backing = backingFromDeployment("bike-nft", bytes)
  assert.equal(backing.address, artifact.manager)
  assert.equal(backing.creationTransaction, artifact.managerCreationTransaction)
  assert.equal(backing.codeHash, artifact.managerCodeHash)
  assert.equal(backing.artifactSha256, `0x${createHash("sha256").update(bytes).digest("hex")}`)
  assert.equal("camRoot" in backing, false)
  assert.throws(() => backingFromDeployment("bike-nft", new TextEncoder().encode('{"schema":"bike-nft.deployment.v2"}')), /Components address/)
})
