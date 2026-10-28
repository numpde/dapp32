import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import type { Address, Hex } from "viem"
import { inspectReleaseCamBundle } from "../release-cam-bundle.ts"
import { backingFromDeployment } from "../ui-release/shared.ts"


import { ownershipState } from "../release-ownership.ts"
import { DEPLOYMENT_SCHEMA, parseDeploymentArtifact, parseContractSettings, requiredAddresses, requiredDelay } from "./shared.ts"
import type { DeploymentArtifact } from "./shared.ts"

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as Address
const hash = (byte: string) => `0x${byte.repeat(64)}` as Hex
const SOURCE = "0123456789abcdef0123456789abcdef01234567"
const DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const CHECKED_IN_CAM_HASH = `0x${createHash("sha256").update(readFileSync(join(DAPPS, "bike-nft/cam/main.json"))).digest("hex")}` as Hex
const DEPLOYER = address("1"), OWNER = address("2"), COMPONENTS_ADMIN = address("3"), MANAGER_ADMIN = address("4")

test("Bike release parsing rejects the old Keccak commitment schemas", () => {
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
  const artifact = deployment()
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, sourceCommit: "HEAD" }))),
    /40 lowercase hexadecimal/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, chainId: 31337 }))),
    /rejects local fixture chain ID/,
  )
  assert.throws(
    () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, intendedCamRootOwner: address("0") }))),
    /must not be the zero address/,
  )
})

test("business settings and deployment artifacts share the single-line text domain", () => {
  const artifact = deployment()
  for (const field of ["tokenName", "tokenSymbol", "baseTokenURI", "collectionURI"] as const) {
    assert.throws(
      () => parseContractSettings({ ...artifact, [field]: "line one\nline two" }),
      new RegExp(`${field} must be a .*single-line string`),
    )
    assert.throws(
      () => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...artifact, [field]: "line one\rline two" }))),
      new RegExp(`${field} must be a .*single-line string`),
    )
  }
})

test("Bike business settings and artifacts keep an explicitly empty metadata base", () => {
  assert.equal(parseContractSettings({ ...deployment(), baseTokenURI: "" }).baseTokenURI, "")
  const artifact = { ...deployment(), baseTokenURI: "" }
  assert.equal(parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify(artifact))).baseTokenURI, "")
})

test("Bike release requires a present string metadata base and keeps other metadata mandatory", () => {
  for (const invalid of [undefined, null, 0, "line\nbreak", "line\rbreak"]) {
    assert.throws(() => parseContractSettings({ ...deployment(), baseTokenURI: invalid }), /baseTokenURI/)
    assert.throws(() => parseDeploymentArtifact(new TextEncoder().encode(JSON.stringify({ ...deployment(), baseTokenURI: invalid }))), /baseTokenURI/)
  }
  for (const field of ["tokenName", "tokenSymbol", "collectionURI"] as const) {
    assert.throws(() => parseContractSettings({ ...deployment(), [field]: "" }), new RegExp(field))
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
function deployment(): DeploymentArtifact { const { expectedChainId, ...fields } = common(); return { ...fields, schema: DEPLOYMENT_SCHEMA, chainId: expectedChainId, deployer: DEPLOYER, camHash: hash("a"), camRoot: address("10"), components: address("11"), manager: address("12"), ui: address("13"), camRootCodeHash: hash("b"), componentsCodeHash: hash("c"), managerCodeHash: hash("d"), uiCodeHash: hash("e"), camRootCreationTransaction: hash("1"), componentsCreationTransaction: hash("2"), managerCreationTransaction: hash("3"), uiCreationTransaction: hash("4") } }

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
