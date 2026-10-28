import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { keccak256, toHex } from "viem"
import { readSourceVerificationInput } from "../release-compiled-contract.ts"
import { sourcePublicationContracts } from "../source-publication.ts"
import type { ReleaseApp } from "./reference-read.ts"

const hash = `0x${"12".repeat(32)}`
const address = (digit: string) => `0x${digit.repeat(40)}`
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

for (const app of ["bike-nft", "escrow", "pay-to-play"] as const) {
  test(`${app}: original full deployment supplies all identities without config or current bindings`, () => {
    const business = app === "bike-nft" ? ["components", "manager"] : app === "escrow" ? ["camEscrow"] : ["payToPlay"]
    const ui = app === "bike-nft" ? "ui" : app === "escrow" ? "camEscrowUI" : "payToPlayUI"
    const artifact: Record<string, unknown> = { schema: `${app}.deployment.v2`, sourceCommit: "a".repeat(40), chainId: 43113, deployer: address("1"), payToPlayCreationInputHash: hash }
    for (const [index, role] of [...business, ui, "camRoot"].entries()) {
      artifact[role] = address(String(index + 2))
      artifact[`${role}CodeHash`] = hash
      artifact[`${role}CreationTransaction`] = `0x${String(index + 2).repeat(64)}`
    }
    const selected = sourcePublicationContracts(app, bytes(artifact))
    assert.equal(selected.length, business.length + 2)
    assert.equal(selected.find(contract => contract.role === "ui")!.identity.address.toLowerCase(), String(artifact[ui]).toLowerCase())
    assert.ok(selected.every(contract => contract.sourceCommit === artifact.sourceCommit && contract.chainId === 43113))
    assert.ok(selected.every(contract => contract.location.contract.length > 0))
    assert.throws(() => sourcePublicationContracts(app, bytes({ ...artifact, schema: "unknown" })), /known business-bearing/)
  })
}

test("source publication exports original settings and hash-checked content, never compilationTarget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "source-publication-"))
  try {
    const source = "pragma solidity 0.8.34; contract CamEscrow {}\n"
    const relative = "escrow/src/CamEscrow.sol"
    const sources = join(directory, "sources")
    const artifacts = join(directory, "artifacts")
    await mkdir(join(sources, "escrow/src"), { recursive: true })
    await mkdir(join(artifacts, "CamEscrow.sol"), { recursive: true })
    await writeFile(join(sources, relative), source)
    await writeFile(join(artifacts, "CamEscrow.sol/CamEscrow.json"), JSON.stringify({
      abi: [], bytecode: { object: "0x6000", linkReferences: {} }, metadata: {
        compiler: { version: "0.8.34+commit.80d5c536" },
        settings: { optimizer: { enabled: true, runs: 999 }, evmVersion: "cancun", compilationTarget: { [relative]: "CamEscrow" } },
        sources: { [relative]: { keccak256: keccak256(toHex(source)) } },
      },
    }))
    const input = await readSourceVerificationInput({ source: relative, contract: "CamEscrow" }, artifacts, sources)
    assert.equal(input.compilerVersion, "0.8.34+commit.80d5c536")
    assert.equal(input.contractIdentifier, `${relative}:CamEscrow`)
    assert.deepEqual(input.stdJsonInput.settings, { optimizer: { enabled: true, runs: 999 }, evmVersion: "cancun" })
    assert.deepEqual(input.stdJsonInput.sources, { [relative]: { content: source } })
    await writeFile(join(sources, relative), "wrong current source")
    await assert.rejects(readSourceVerificationInput({ source: relative, contract: "CamEscrow" }, artifacts, sources), /source hash mismatch/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("an app cannot publish another app's deployment", () => {
  assert.throws(() => sourcePublicationContracts("bike-nft" as ReleaseApp, bytes({ schema: "escrow.deployment.v2" })), /known business-bearing/)
})
