import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { keccak256, toHex } from "viem"
import { readCompiledContractSource } from "../release-compiled-contract.ts"
import { retainCompilationSources, removeExpandedAuthoringSources } from "./retain-sources.ts"

test("compact records retain the ordinary compiler reader's exact source evidence", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cam-retention-"))
  try {
    const compiler = resolve(directory, "compiler")
    const sources = resolve(directory, "sources")
    const source = "contract CamRoot {}\n"
    const relative = "cam/src/CamRoot.sol"
    await mkdir(resolve(compiler, "CamRoot.sol"), { recursive: true })
    await mkdir(resolve(sources, "dapps/cam/src"), { recursive: true })
    await writeFile(resolve(sources, "dapps", relative), source)
    await writeFile(resolve(sources, "dapps/demo.png"), "irrelevant image")
    await writeFile(resolve(sources, "README.md"), "irrelevant checkout file")
    const artifact = { abi: [], bytecode: { object: "0x6000", linkReferences: {} }, metadata: {
      compiler: { version: "0.8.35" }, settings: { compilationTarget: { [relative]: "CamRoot" } },
      sources: { [relative]: { keccak256: keccak256(toHex(source)) } },
    } }
    await writeFile(resolve(compiler, "CamRoot.sol/CamRoot.json"), JSON.stringify(artifact))
    const location = { source: relative, contract: "CamRoot" }
    const before = await readCompiledContractSource(location, compiler, resolve(sources, "dapps"))
    await retainCompilationSources(compiler, sources)
    assert.deepEqual(await readCompiledContractSource(location, compiler, resolve(sources, "dapps")), before)
    await assert.rejects(readFile(resolve(sources, "dapps/demo.png")), { code: "ENOENT" })
    await assert.rejects(readFile(resolve(sources, "README.md")), { code: "ENOENT" })
    await writeFile(resolve(sources, "dapps", relative), "changed")
    await assert.rejects(readCompiledContractSource(location, compiler, resolve(sources, "dapps")), /source hash mismatch/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("authoring checkout retirement preserves the separately staged bundle", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cam-authoring-retention-"))
  try {
    await mkdir(resolve(directory, "authoring/dapps"), { recursive: true })
    await mkdir(resolve(directory, "bundle"))
    await writeFile(resolve(directory, "authoring/dapps/main.json"), "original")
    await writeFile(resolve(directory, "authoring/README.md"), "checkout")
    await writeFile(resolve(directory, "bundle/main.json"), "published")
    await removeExpandedAuthoringSources(resolve(directory, "authoring"))
    assert.equal(await readFile(resolve(directory, "bundle/main.json"), "utf8"), "published")
    await assert.rejects(readFile(resolve(directory, "authoring/README.md")), { code: "ENOENT" })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
