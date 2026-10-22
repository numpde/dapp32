import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { sha256 } from "viem"

import { assertReleaseCamURI, inspectReleaseCamBundle } from "./release-cam-bundle.ts"
import { stageVerifiedReleaseArtifact } from "./release-verification-input.ts"

const REPOSITORY_DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../dapps")
const ESCROW_CAM = join(REPOSITORY_DAPPS, "escrow/cam")
const CAM_URI = "https://example.test/escrow/cam/main.json"
const ZERO_HASH = `0x${"00".repeat(32)}` as const
const SOURCE_COMMIT = "0123456789abcdef0123456789abcdef01234567"

for (const app of ["bike-nft", "escrow", "pay-to-play"]) {
  test(`${app} release planner preserves an explicit zero hash and validates other selections`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "release-hash-plan-"))
    const prefix = app.replaceAll("-", "_").toUpperCase() + "_RELEASE_"
    const rootPath = join(REPOSITORY_DAPPS, app, "cam/main.json")
    const digest = sha256(await readFile(rootPath))
    try {
      for (const [index, selection] of [undefined, "auto", ZERO_HASH, digest, "0x01", `0x${"ab".repeat(32)}`, ""].entries()) {
        const planPath = join(directory, `${index}.json`)
        const settings = {
          DAPPS_ROOT: REPOSITORY_DAPPS, CAM_ROOT_PATH: rootPath, PLAN_PATH: planPath,
          CAM_URI, SOURCE_COMMIT, EXPECTED_CHAIN_ID: "43113",
          INTENDED_CAM_ROOT_OWNER: `0x${"11".repeat(20)}`, INTENDED_PAYMENT_ADMIN: `0x${"22".repeat(20)}`,
          NULL_CLAIM_PERIOD: "0", TOKEN_NAME: "Bike", TOKEN_SYMBOL: "BIKE",
          BASE_TOKEN_URI: "https://example.test/tokens/", COLLECTION_URI: "https://example.test/collection.json",
          INTENDED_COMPONENTS_ADMIN: `0x${"22".repeat(20)}`, COMPONENTS_ADMIN_DELAY: "60",
          COMPONENTS_PAUSER: `0x${"33".repeat(20)}`, COMPONENTS_CONFIGURER: `0x${"33".repeat(20)}`,
          INTENDED_MANAGER_ADMIN: `0x${"44".repeat(20)}`, MANAGER_ADMIN_DELAY: "60",
          MANAGER_PAUSER: `0x${"33".repeat(20)}`, MANAGER_CONFIGURER: `0x${"33".repeat(20)}`,
          REGISTRARS: `0x${"55".repeat(20)}`,
        }
        const env: NodeJS.ProcessEnv = { ...process.env, ...Object.fromEntries(Object.entries(settings).map(([key, value]) => [prefix + key, value])) }
        delete env[prefix + "CAM_HASH"]
        if (selection !== undefined) env[prefix + "CAM_HASH"] = selection
        const result = spawnSync(process.execPath, ["--experimental-strip-types", join(dirname(fileURLToPath(import.meta.url)), `${app}-release/plan.ts`)], { encoding: "utf8", env })
        if (selection === "0x01" || selection === "" || selection === `0x${"ab".repeat(32)}`) {
          assert.notEqual(result.status, 0, `planner accepted ${selection}`)
          await assert.rejects(readFile(planPath), /ENOENT/)
        } else {
          assert.equal(result.status, 0, result.stderr)
          assert.equal(JSON.parse(await readFile(planPath, "utf8")).camHash, selection === ZERO_HASH ? ZERO_HASH : digest)
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}

test("verification preserves zero commitment while still checking the source bundle", async () => {
  const fixture = await copiedEscrowCamFixture()
  const artifact = { sourceCommit: SOURCE_COMMIT, camURI: CAM_URI, camHash: ZERO_HASH }
  const artifactPath = join(fixture.directory, "artifact.json")
  try {
    await writeFile(artifactPath, JSON.stringify(artifact))
    const verify = (snapshotPath: string) => stageVerifiedReleaseArtifact({
      artifactPath, parseArtifact: bytes => JSON.parse(new TextDecoder().decode(bytes)) as typeof artifact,
      expectedSourceCommit: SOURCE_COMMIT, dappsRootPath: fixture.dappsRootPath,
      rootPath: fixture.rootPath, snapshotPath, label: "fixture",
    })
    assert.deepEqual(await verify(join(fixture.directory, "verified.json")), artifact)
    const root = await readRootRecord(fixture.rootPath)
    await unlink(resolve(dirname(fixture.rootPath), escrowNamespace(root).abiURI))
    await assert.rejects(verify(join(fixture.directory, "invalid.json")), /does not exist/)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("private release CAM transport requires the explicit fixture environment and exact origin", () => {
  const local = "http://release-cam:8080/pay-to-play/main.json"
  assert.throws(() => assertReleaseCamURI(local, "CAM", {}), /publication URI/)
  assertReleaseCamURI(CAM_URI, "CAM", {})
  assertReleaseCamURI(local, "CAM", { RELEASE_REHEARSAL: "1" })
  for (const uri of ["http://localhost/main.json", "http://other:8080/main.json", "https://example.test/main.json"]) {
    assert.throws(() => assertReleaseCamURI(uri, "CAM", { RELEASE_REHEARSAL: "1" }), /rehearsal CAM/)
  }
  assert.throws(() => assertReleaseCamURI(local, "CAM", { RELEASE_REHEARSAL: "yes" }), /RELEASE_REHEARSAL/)
})

test("release CAM roots must stay inside the declared dapps root", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-cam-boundary-"))
  const dappsRootPath = join(directory, "dapps")
  const rootPath = join(directory, "main.json")
  try {
    await mkdir(dappsRootPath)
    await writeFile(rootPath, "{}\n")
    await assert.rejects(
      inspectReleaseCamBundle({ dappsRootPath, rootPath, camURI: CAM_URI, label: "fixture" }),
      /fixture CAM root must stay under dapps root/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("release CAM inspection rejects unsafe local resource paths", async () => {
  const fixture = await copiedEscrowCamFixture()
  try {
    const root = await readRootRecord(fixture.rootPath)
    escrowNamespace(root).abiURI = "./../escape.json"
    await writeRootRecord(fixture.rootPath, root)
    await assert.rejects(
      inspectFixture(fixture, "fixture"),
      /namespaces\.contracts\.CamEscrow: CAM resource URI must be/,
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("release CAM inspection rejects missing declared resources", async () => {
  const fixture = await copiedEscrowCamFixture()
  try {
    const root = await readRootRecord(fixture.rootPath)
    const resourceURI = escrowNamespace(root).abiURI
    await unlink(resolve(dirname(fixture.rootPath), resourceURI))
    await assert.rejects(
      inspectFixture(fixture, "fixture"),
      /local CAM resource .* does not exist/,
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("release CAM conformance failures retain the application label", async () => {
  const fixture = await copiedEscrowCamFixture()
  try {
    const root = await readRootRecord(fixture.rootPath)
    const namespace = escrowNamespace(root)
    const malformedBytes = new TextEncoder().encode("{")
    await writeFile(resolve(dirname(fixture.rootPath), namespace.abiURI), malformedBytes)
    namespace.integrity = `sha256:0x${createHash("sha256").update(malformedBytes).digest("hex")}`
    await writeRootRecord(fixture.rootPath, root)
    await assert.rejects(
      inspectFixture(fixture, "escrow fixture"),
      /escrow fixture CAM bundle does not conform:/,
    )
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("release CAM hashing uses the exact raw root bytes", async () => {
  const fixture = await copiedEscrowCamFixture()
  try {
    const originalBytes = await readFile(fixture.rootPath)
    await writeFile(fixture.rootPath, Buffer.concat([originalBytes, Buffer.from("\n")]))
    const rootBytes = await readFile(fixture.rootPath)
    const inspected = await inspectFixture(fixture, "fixture")
    assert.equal(inspected.camHash, sha256(rootBytes))
    assert.notEqual(inspected.camHash, sha256(originalBytes))
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

type CamFixture = {
  readonly directory: string
  readonly dappsRootPath: string
  readonly rootPath: string
}

type CamRootRecord = {
  namespaces: Record<string, { abiURI?: string; integrity?: string }>
}

async function copiedEscrowCamFixture(): Promise<CamFixture> {
  const directory = await mkdtemp(join(tmpdir(), "release-cam-fixture-"))
  const dappsRootPath = join(directory, "dapps")
  const camPath = join(dappsRootPath, "escrow/cam")
  await mkdir(dappsRootPath)
  await cp(ESCROW_CAM, camPath, { recursive: true })
  return { directory, dappsRootPath, rootPath: join(camPath, "main.json") }
}

async function inspectFixture(fixture: CamFixture, label: string) {
  return inspectReleaseCamBundle({
    dappsRootPath: fixture.dappsRootPath,
    rootPath: fixture.rootPath,
    camURI: CAM_URI,
    label,
  })
}

async function readRootRecord(rootPath: string): Promise<CamRootRecord> {
  return JSON.parse(await readFile(rootPath, "utf8")) as CamRootRecord
}

async function writeRootRecord(rootPath: string, root: CamRootRecord): Promise<void> {
  await writeFile(rootPath, `${JSON.stringify(root)}\n`)
}

function escrowNamespace(root: CamRootRecord): { abiURI: string; integrity: string } {
  const namespace = root.namespaces["contracts.CamEscrow"]
  if (namespace === undefined || namespace.abiURI === undefined || namespace.integrity === undefined) {
    throw new Error("escrow CAM fixture must declare contracts.CamEscrow")
  }
  return namespace as { abiURI: string; integrity: string }
}
