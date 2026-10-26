import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import type { UIDeploymentArtifact } from "./shared.ts"
import type { UIReleasePlan } from "./shared.ts"

test("UI artifact publication is exclusive and a keyless retry preserves an existing verified record", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ui-artifact-publish-"))
  try {
    const plan = join(directory, "plan.json")
    const staged = join(directory, "candidate.json")
    const output = join(directory, "ui-deployment.json")
    const backing: UIReleasePlan["backing"] = { sourceCommit: "b".repeat(40), chainId: 43113,
      creator: `0x${"11".repeat(20)}`, address: `0x${"22".repeat(20)}`, artifactSha256: `0x${"ab".repeat(32)}`,
      codeHash: `0x${"cd".repeat(32)}`, creationTransaction: `0x${"12".repeat(32)}`, creationInputHash: `0x${"34".repeat(32)}` }
    const selected: UIReleasePlan = { schema: "cam.ui-release-plan.v1", app: "escrow", sourceCommit: "a".repeat(40),
      expectedChainId: 43113, backing }
    const planBytes = JSON.stringify(selected) + "\n"
    await writeFile(plan, planBytes)
    const candidate: UIDeploymentArtifact = { schema: "cam.ui-deployment.v1", app: "escrow", sourceCommit: selected.sourceCommit,
      chainId: 43113, creator: `0x${"33".repeat(20)}`, referenceSha256: `0x${"56".repeat(32)}`, backing,
      planSha256: `0x${createHash("sha256").update(planBytes).digest("hex")}`,
      ui: { address: `0x${"44".repeat(20)}`, creationTransaction: `0x${"78".repeat(32)}`,
        creationInputHash: `0x${"9a".repeat(32)}`, codeHash: `0x${"bc".repeat(32)}` },
      verificationBlock: { number: "0x10", hash: `0x${"ab".repeat(32)}` } }
    await writeFile(staged, JSON.stringify(candidate))
    const run = () => spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./publish.ts", import.meta.url))], {
      env: { ...process.env, UI_RELEASE_PLAN_PATH: plan, UI_RELEASE_CANDIDATE_PATH: staged, UI_RELEASE_ARTIFACT_PATH: output },
      encoding: "utf8",
    })
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    const original = await readFile(output, "utf8")
    await writeFile(staged, JSON.stringify({ ...candidate, verificationBlock: { number: "0x11", hash: `0x${"cd".repeat(32)}` } }))
    const retry = run()
    assert.equal(retry.status, 0, retry.stderr)
    assert.equal(await readFile(output, "utf8"), original)
    await writeFile(staged, JSON.stringify({ ...candidate, sourceCommit: "b".repeat(40) }))
    const changed = run()
    assert.notEqual(changed.status, 0)
    assert.match(changed.stderr, /differs.*left unchanged/)
    assert.equal(await readFile(output, "utf8"), original)
    await writeFile(staged, JSON.stringify(candidate))
    await writeFile(output, JSON.stringify({ ...candidate, verificationBlock: { number: "yesterday", hash: candidate.verificationBlock.hash } }))
    const malformed = await readFile(output, "utf8")
    const refused = run()
    assert.notEqual(refused.status, 0)
    assert.match(refused.stderr, /verification block number/)
    assert.equal(await readFile(output, "utf8"), malformed)
    await writeFile(plan, planBytes + "\n")
    const planChanged = run()
    assert.notEqual(planChanged.status, 0)
    assert.match(planChanged.stderr, /candidate differs.*plan/)
    assert.equal(await readFile(output, "utf8"), malformed)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
