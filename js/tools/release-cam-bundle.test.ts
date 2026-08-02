import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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

import { keccak256 } from "viem"

import { inspectReleaseCamBundle } from "./release-cam-bundle.ts"

const REPOSITORY_DAPPS = join(dirname(fileURLToPath(import.meta.url)), "../../dapps")
const ESCROW_CAM = join(REPOSITORY_DAPPS, "escrow/cam")
const CAM_URI = "https://example.test/escrow/cam/main.json"

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
    assert.equal(inspected.camHash, keccak256(rootBytes))
    assert.notEqual(inspected.camHash, keccak256(originalBytes))
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
