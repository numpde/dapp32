import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { keccak256, toHex } from "viem"

import { escrowReference } from "../escrow-release/reference.ts"
import { prepareReferenceSnapshot, parseReferenceSnapshot } from "./reference-snapshot.ts"

const deployer = "0x0000000000000000000000000000000000000011"
const owner = "0x0000000000000000000000000000000000000022"
const sourceCommit = "0123456789abcdef0123456789abcdef01234567"
const plan = new TextEncoder().encode(JSON.stringify({
  schema: "escrow.release-plan.v2", sourceCommit, expectedChainId: 8453,
  camURI: "https://example.test/cam/main.json", camHash: `0x${"ab".repeat(32)}`,
  intendedCamRootOwner: owner,
}))

async function fixture(work: (input: { artifacts: string; sources: string }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "cam-reference-snapshot-"))
  const artifacts = join(root, "artifacts")
  const sources = join(root, "sources")
  try {
    for (const [contract, path, abi] of [
      ["CamRoot", "cam/src/CamRoot.sol", [
        { type: "constructor", inputs: [{ type: "address" }, { type: "string" }, { type: "bytes32" }] },
        { type: "function", name: "setContractAddress", inputs: [{ type: "string" }, { type: "address" }] },
        { type: "function", name: "transferOwnership", inputs: [{ type: "address" }] },
      ]],
      ["CamEscrow", "escrow/src/CamEscrow.sol", [{ type: "constructor", inputs: [] }]],
      ["CamEscrowUI", "escrow/src/CamEscrowUI.sol", [{ type: "constructor", inputs: [{ type: "address" }] }]],
    ] as const) {
      const content = `pragma solidity 0.8.35; contract ${contract} {}`
      const sourceFile = join(sources, path)
      const artifactFile = join(artifacts, `${contract}.sol`, `${contract}.json`)
      await mkdir(join(sourceFile, ".."), { recursive: true })
      await mkdir(join(artifactFile, ".."), { recursive: true })
      await writeFile(sourceFile, content)
      await writeFile(artifactFile, JSON.stringify({
        abi, bytecode: { object: "0x60006000", linkReferences: {} },
        metadata: {
          compiler: { version: "0.8.35+commit.47b9dedd" },
          settings: { compilationTarget: { [path]: contract }, optimizer: { enabled: true, runs: 200 }, evmVersion: "prague" },
          sources: { [path]: { keccak256: keccak256(toHex(content)) } },
        },
      }))
    }
    await work({ artifacts, sources })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test("compiler-backed snapshot binds plan, sender, creation bytes, ABI and source bytes", async () => {
  await fixture(async ({ artifacts, sources }) => {
    const expected = escrowReference(plan, deployer)
    const snapshot = await prepareReferenceSnapshot("escrow", expected, plan, artifacts, sources)
    assert.equal(snapshot.schema, "release-approval.reference.v2")
    assert.equal(snapshot.sourceCommit, sourceCommit)
    assert.equal(snapshot.expectedDeployer, deployer)
    assert.equal(snapshot.planSha256, `0x${createHash("sha256").update(plan).digest("hex")}`)
    assert.deepEqual(snapshot.contracts.map((item) => item.role), ["camRoot", "escrow", "ui"])
    assert.equal(snapshot.contracts[0]?.creationBytecode, "0x60006000")
    assert.equal(snapshot.contracts[0]?.compilerVersion, "0.8.35+commit.47b9dedd")
    assert.deepEqual(parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(snapshot))), snapshot)
  })
})

test("preparation stops on changed sources, unlinked bytecode, wrong ABI and wrong compiler", async () => {
  for (const [change, match] of [
    [async ({ sources }: { artifacts: string; sources: string }) => writeFile(join(sources, "cam/src/CamRoot.sol"), "different source"), /source hash mismatch/],
    [async ({ artifacts }: { artifacts: string; sources: string }) => alterArtifact(artifacts, (value) => { value.bytecode.linkReferences = { library: { Lib: [{ length: 20, start: 1 }] } } }), /link references/],
    [async ({ artifacts }: { artifacts: string; sources: string }) => alterArtifact(artifacts, (value) => { value.abi = value.abi.filter((item: { name?: string }) => item.name !== "setContractAddress") }), /ABI.*setContractAddress/],
    [async ({ artifacts }: { artifacts: string; sources: string }) => alterArtifact(artifacts, (value) => { value.metadata.compiler.version = "0.8.34+commit.12345678" }), /compiler version/],
  ] as const) {
    await fixture(async (input) => {
      await change(input)
      await assert.rejects(prepareReferenceSnapshot("escrow", escrowReference(plan, deployer), plan, input.artifacts, input.sources), match)
    })
  }
})

test("snapshot parser rejects bytecode mutation and identity substitution", async () => {
  await fixture(async ({ artifacts, sources }) => {
    const snapshot = await prepareReferenceSnapshot("escrow", escrowReference(plan, deployer), plan, artifacts, sources)
    const parse = (value: unknown) => parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(value)))
    assert.throws(() => parse({ ...snapshot, expectedDeployer: owner }), /snapshot digest mismatch/)
    assert.throws(() => parse({ ...snapshot, contracts: snapshot.contracts.map((item, i) => i === 0 ? { ...item, creationBytecode: "0x6000" } : item) }), /snapshot digest mismatch/)
  })
})

test("snapshot presentation is required, bounded and bound to the selected reference", async () => {
  await fixture(async ({ artifacts, sources }) => {
    const expected = escrowReference(plan, deployer)
    const snapshot = await prepareReferenceSnapshot("escrow", expected, plan, artifacts, sources)
    const parse = (value: unknown) => parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(value)))
    const rehash = (value: Record<string, unknown>) => {
      const { snapshotSha256: ignored, ...base } = value
      void ignored
      return { ...base, snapshotSha256: `0x${createHash("sha256").update(JSON.stringify(base)).digest("hex")}` }
    }
    const changed = { ...snapshot, steps: snapshot.steps.map((step, index) => index === 0 ? { ...step, action: "Different action" } : step) }
    assert.throws(() => parse(changed), /snapshot digest mismatch/)
    await assert.rejects(prepareReferenceSnapshot("escrow", { ...expected, steps: changed.steps }, plan, artifacts, sources), /differ from the validated release plan/)
    assert.throws(() => parse(rehash({ ...snapshot, schema: "release-approval.reference.v1" })), /unsupported.*schema/)
    for (const presentation of [
      { action: "" }, { action: "line\nbreak" }, { action: "\u001b[31m" }, { action: "\u202e" }, { action: "x".repeat(257) },
      { argumentLabels: [] }, { argumentLabels: ["", "CAM URI", "CAM hash"] },
      { argumentLabels: ["Owner", "CAM\rURI", "CAM hash"] }, { argumentLabels: ["x".repeat(129), "CAM URI", "CAM hash"] },
    ]) {
      assert.throws(() => parse(rehash({ ...snapshot, steps: snapshot.steps.map((step, index) => index === 0 ? { ...step, ...presentation } : step) })), /action|argument labels/)
    }
  })
})

test("compiler artifacts reject a symlinked root or intermediate directory", async () => {
  const expected = escrowReference(plan, deployer)
  await fixture(async ({ artifacts, sources }) => {
    const alias = join(dirname(artifacts), "artifacts-alias")
    await symlink(artifacts, alias, "dir")
    await assert.rejects(prepareReferenceSnapshot("escrow", expected, plan, alias, sources), /compiler artifact.*symlink/)
  })
  await fixture(async ({ artifacts, sources }) => {
    await rename(join(artifacts, "CamRoot.sol"), join(artifacts, "CamRoot-real.sol"))
    await symlink("CamRoot-real.sol", join(artifacts, "CamRoot.sol"), "dir")
    await assert.rejects(prepareReferenceSnapshot("escrow", expected, plan, artifacts, sources), /compiler artifact.*symlink/)
  })
})

test("compiler source metadata cannot traverse outside its source root", async () => {
  await fixture(async ({ artifacts, sources }) => {
    await alterArtifact(artifacts, (value) => {
      value.metadata.sources["cam/src/../../outside.sol"] = { keccak256: `0x${"ab".repeat(32)}` }
    })
    await assert.rejects(prepareReferenceSnapshot("escrow", escrowReference(plan, deployer), plan, artifacts, sources), /compiler source path is unsafe/)
  })
})

test("snapshot loading rejects duplicate contract roles, duplicate ABI functions and malformed steps", async () => {
  await fixture(async ({ artifacts, sources }) => {
    const snapshot = await prepareReferenceSnapshot("escrow", escrowReference(plan, deployer), plan, artifacts, sources)
    const parse = (value: unknown) => parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(value)))
    const rehash = (value: typeof snapshot) => {
      const { snapshotSha256: ignored, ...base } = value
      void ignored
      return { ...base, snapshotSha256: `0x${createHash("sha256").update(JSON.stringify(base)).digest("hex")}` }
    }
    const duplicateRole = rehash({ ...snapshot, contracts: [snapshot.contracts[0]!, snapshot.contracts[0]!, snapshot.contracts[2]!] })
    assert.throws(() => parse(duplicateRole), /duplicate compiler contract role/)
    const root = snapshot.contracts[0]!
    const functionAbi = root.abi.find((item) => item.type === "function" && item.name === "setContractAddress")!
    const duplicateAbi = rehash({ ...snapshot, contracts: [{ ...root, abi: [...root.abi, functionAbi] }, ...snapshot.contracts.slice(1)] })
    assert.throws(() => parse(duplicateAbi), /duplicate ABI function/)
    const unknownRole = rehash({ ...snapshot, steps: snapshot.steps.map((step, index) => index === 3 ? { ...step, args: ["CamEscrowUI", { createdContract: "unknown" }] } : step) })
    assert.throws(() => parse(unknownRole), /unknown or future created contract role/)
    const missingSignature = rehash({ ...snapshot, steps: snapshot.steps.map((step, index) => index === 3 ? { kind: "call" as const, role: step.role, name: step.name, action: step.action, argumentLabels: step.argumentLabels, args: step.args } : step) })
    assert.throws(() => parse(missingSignature), /call signature/)
  })
})

async function alterArtifact(artifacts: string, alter: (value: any) => void): Promise<void> {
  const file = join(artifacts, "CamRoot.sol", "CamRoot.json")
  const value = JSON.parse(await readFile(file, "utf8"))
  alter(value)
  await writeFile(file, JSON.stringify(value))
}
