import assert from "node:assert/strict"
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { sha256, type Abi } from "viem"

import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import { stageCamBundle } from "./bundle.ts"

const repositoryDapps = resolve(dirname(fileURLToPath(import.meta.url)), "../../../dapps")
const rootURI = "https://example.test/cam/main.json"

test("staging preserves authored non-ABI bytes and selects independent core/UI ABIs", async () => {
  const fixture = await copiedCam("pay-to-play")
  try {
    // Whitespace is part of the authored resource, even when semantically redundant.
    await writeFile(join(fixture.cam, "ui.json"), Buffer.concat([await readFile(join(fixture.cam, "ui.json")), Buffer.from(" \n")]))
    const before = await sourceBytes(fixture.cam)
    const originalCore = fixture.contractABIs.get("PayToPlay")!
    const olderCore = originalCore.filter(item => !(item.type === "function" && item.name === "MAX_CLAIM_PERIOD"))
    const newerUI: Abi = [...fixture.contractABIs.get("PayToPlayUI")!, {
      type: "function", name: "releaseLabel", stateMutability: "view", inputs: [], outputs: [{ type: "string" }],
    }]
    assert.notDeepEqual(olderCore, originalCore)
    fixture.contractABIs.set("PayToPlay", olderCore)
    fixture.contractABIs.set("PayToPlayUI", newerUI)
    const staged = await stageCamBundle(fixture.options)
    assert.equal(staged.authoredRootSha256, sha256(before.get("main.json")!))
    assert.equal(staged.rootSha256, sha256(staged.rootBytes))
    assert.deepEqual(await readFile(join(fixture.outputDir, "main.json")), Buffer.from(staged.rootBytes))
    for (const uri of ["./ui.json", "./protocol.html"]) {
      assert.deepEqual(Buffer.from(staged.resources.get(uri)!), before.get(uri.slice(2)))
    }
    for (const [uri, abi] of [["./abi/PayToPlay.json", olderCore], ["./abi/PayToPlayUI.json", newerUI]] as const) {
      const stagedBytes = staged.resources.get(uri)!
      assert.deepEqual(JSON.parse(new TextDecoder().decode(stagedBytes)), abi)
      assert.deepEqual(await readFile(resolve(fixture.outputDir, uri)), Buffer.from(stagedBytes))
    }
    const root = JSON.parse(new TextDecoder().decode(staged.rootBytes))
    const authored = JSON.parse(before.get("main.json")!.toString())
    authored.protocol.integrity = root.protocol.integrity
    for (const name of Object.keys(authored.namespaces)) {
      if ("integrity" in root.namespaces[name]) authored.namespaces[name].integrity = root.namespaces[name].integrity
    }
    assert.deepEqual(root, authored)
    assert.deepEqual(validateCamBundle({ rootURI, rootBytes: staged.rootBytes, resources: staged.resources }), [])
    assert.deepEqual(await sourceBytes(fixture.cam), before)

    // ABI object insertion order cannot alter a release commitment.
    const secondOutput = join(fixture.directory, "second")
    await mkdir(secondOutput)
    const reordered = new Map([...fixture.contractABIs].reverse().map(([name, abi]) => [name,
      abi.map(item => Object.fromEntries(Object.entries(item).reverse())) as unknown as Abi,
    ]))
    const repeated = await stageCamBundle({ ...fixture.options, outputDir: secondOutput, contractABIs: reordered })
    assert.deepEqual(repeated.rootBytes, staged.rootBytes)
    assert.deepEqual(repeated.resources, staged.resources)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("staging rejects authored routes unsupported by the supplied original ABI before exporting bytes", async () => {
  const fixture = await copiedCam("pay-to-play")
  try {
    const before = await sourceBytes(fixture.cam)
    fixture.contractABIs.set("PayToPlay", fixture.contractABIs.get("PayToPlay")!
      .filter(item => !(item.type === "function" && item.name === "viewPosition")))
    await assert.rejects(stageCamBundle(fixture.options), /CAM_ROUTE_ABI_MISMATCH:.*viewPosition/)
    assert.deepEqual(await readdir(fixture.outputDir), [])
    assert.deepEqual(await sourceBytes(fixture.cam), before)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("staging requires exact logical ABI coverage, including Bike's interface-only namespace", async () => {
  const fixture = await copiedCam("bike-nft")
  try {
    assert(fixture.contractABIs.has("ICamRootOwnership"))
    const interfaceABI = fixture.contractABIs.get("ICamRootOwnership")!.filter(item => item.type !== "constructor")
    fixture.contractABIs.delete("ICamRootOwnership")
    await assert.rejects(stageCamBundle(fixture.options), /missing \["ICamRootOwnership"\]/)
    fixture.contractABIs.set("ICamRootOwnership", interfaceABI)
    fixture.contractABIs.set("Undeclared", [])
    await assert.rejects(stageCamBundle(fixture.options), /extra \["Undeclared"\]/)
    fixture.contractABIs.delete("Undeclared")
    const staged = await stageCamBundle(fixture.options)
    assert.deepEqual(JSON.parse(new TextDecoder().decode(staged.resources.get("./abi/ICamRootOwnership.json")!)), interfaceABI)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

test("staging requires an existing empty real output directory outside authored sources", async () => {
  const fixture = await copiedCam("pay-to-play")
  try {
    const before = await sourceBytes(fixture.cam)
    await writeFile(join(fixture.outputDir, "operator-artifact"), "keep these bytes")
    await assert.rejects(stageCamBundle(fixture.options), /output directory must be empty/)
    assert.equal(await readFile(join(fixture.outputDir, "operator-artifact"), "utf8"), "keep these bytes")
    await assert.rejects(stageCamBundle({ ...fixture.options, outputDir: join(fixture.directory, "absent") }), /ENOENT/)
    const sourceOutput = join(fixture.cam, "output")
    await mkdir(sourceOutput)
    await assert.rejects(stageCamBundle({ ...fixture.options, outputDir: sourceOutput }), /outside the authored dapps tree/)
    const link = join(fixture.directory, "linked")
    await symlink(fixture.outputDir, link)
    await assert.rejects(stageCamBundle({ ...fixture.options, outputDir: link }), /real directory/)
    const parentLink = join(fixture.directory, "parent-link")
    await symlink(fixture.directory, parentLink)
    await assert.rejects(stageCamBundle({ ...fixture.options, outputDir: join(parentLink, "output") }), /real directory/)
    assert.deepEqual(await sourceBytes(fixture.cam), before)
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
  }
})

async function copiedCam(app: string) {
  const directory = await mkdtemp(join(tmpdir(), "cam-bundle-stage-"))
  const dappsRootPath = join(directory, "dapps")
  const cam = join(dappsRootPath, app, "cam")
  const outputDir = join(directory, "output")
  await cp(join(repositoryDapps, app, "cam"), cam, { recursive: true })
  await mkdir(outputDir)
  const rootPath = join(cam, "main.json")
  const root = JSON.parse(await readFile(rootPath, "utf8")) as {
    namespaces: Record<string, { type: string; abiURI?: string }>
  }
  const contractABIs = new Map<string, Abi>()
  for (const [namespace, declaration] of Object.entries(root.namespaces)) {
    if (declaration.type !== "contract") continue
    contractABIs.set(namespace.slice("contracts.".length), JSON.parse(await readFile(resolve(cam, declaration.abiURI!), "utf8")) as Abi)
  }
  return { directory, cam, outputDir, contractABIs,
    options: { dappsRootPath, rootPath, outputDir, contractABIs } }
}

async function sourceBytes(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  async function collect(path: string, prefix: string): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      const child = join(path, name)
      const key = prefix + name
      if ((await lstat(child)).isDirectory()) await collect(child, `${key}/`)
      else files.set(key, await readFile(child))
    }
  }
  await collect(directory, "")
  return files
}
