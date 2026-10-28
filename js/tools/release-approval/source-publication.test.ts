import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { keccak256, toHex, zeroAddress } from "viem"
import { readSourceVerificationInput } from "../release-compiled-contract.ts"
import { sourcePublicationContracts, sourcePublicationCatalog } from "../source-publication.ts"
import type { ReleaseApp } from "./reference-read.ts"

const hash = `0x${"12".repeat(32)}`
const address = (digit: string) => `0x${digit.repeat(40)}`
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

test("contract catalog deduplicates the existing root and keeps replacement and original UIs distinct", () => {
  const identity = (digit: string) => ({ address: address(digit), codeHash: hash, creationTransaction: `0x${digit.repeat(64)}`, creationInputHash: hash })
  const original = { schema: "bike-nft.deployment.v1", chainId: 43113, sourceCommit: "a".repeat(40), deployer: address("1"),
    components: address("2"), componentsCodeHash: hash, componentsCreationTransaction: identity("2").creationTransaction,
    manager: address("3"), managerCodeHash: hash, managerCreationTransaction: identity("3").creationTransaction,
    ui: address("4"), uiCodeHash: hash, uiCreationTransaction: identity("4").creationTransaction,
    camRoot: address("5"), camRootCodeHash: hash, camRootCreationTransaction: identity("5").creationTransaction }
  const replacement = { schema: "cam.ui-deployment.v1", app: "bike-nft", chainId: 43113, sourceCommit: "b".repeat(40), creator: address("1"),
    planSha256: hash, referenceSha256: hash, backing: { sourceCommit: "a".repeat(40), chainId: 43113, creator: address("1"), artifactSha256: hash, ...identity("3") },
    ui: identity("6"), verificationBlock: { number: "0x10", hash } }
  const publication = { schema: "cam.publication.v1", app: "bike-nft", sourceCommit: "b".repeat(40), chainId: 43113, signer: address("1"),
    planSha256: hash, referenceSha256: hash, businessArtifactSha256: hash, uiArtifactSha256: hash, bundleArtifactSha256: hash,
    root: { sourceCommit: "a".repeat(40), creator: address("1"), contract: identity("5") },
    bindings: { ICamRootOwnership: address("5"), BicycleComponentManager: address("3"), BicycleComponentManagerUI: address("6"), BicycleComponents: address("2") },
    manifest: { uri: "https://example.test/main.json", hash }, authority: { owner: address("1"), pendingOwner: zeroAddress },
    transactions: [hash], verificationBlock: { number: "0x10", hash }, predecessor: null }
  const records = [{ path: "original", artifact: original }, { path: "replacement", artifact: replacement }, { path: "publication", artifact: publication }]
  const catalog = sourcePublicationCatalog("bike-nft", records, "publication")
  assert.equal(catalog.contracts.length, 5)
  assert.equal(catalog.contracts.filter(contract => contract.selected).length, 4)
  assert.equal(catalog.contracts.filter(contract => contract.role === "camRoot").length, 1)
  assert.equal(catalog.contracts.find(contract => contract.identity.address === address("4"))!.selected, false)
  assert.equal(catalog.contracts.find(contract => contract.identity.address === address("6"))!.sourceCommit, "b".repeat(40))
  assert.throws(() => sourcePublicationCatalog("bike-nft", [...records, { path: "contradiction", artifact: {
    ...replacement, ui: { ...replacement.ui, creationInputHash: `0x${"99".repeat(32)}` },
  } }], "publication"), /disagree about source provenance/)
  assert.throws(() => sourcePublicationCatalog("bike-nft", [records[0]!, records[2]!], "publication"), /no source records/)
  assert.throws(() => sourcePublicationCatalog("bike-nft", records, "missing"), /missing from the source inventory/)
})

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
