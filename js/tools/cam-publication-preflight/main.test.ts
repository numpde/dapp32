import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

const preflightPath = fileURLToPath(new URL("./main.ts", import.meta.url))

test("human diagnostics escape and bound operator-controlled paths while JSON stays complete", () => {
  const dappsRoot = mkdtempSync(join(tmpdir(), "cam-preflight-"))
  try {
    const directories = Array.from({ length: 4 }, () => "d".repeat(200))
    let currentDirectory = dappsRoot
    for (const directory of directories) {
      currentDirectory = join(currentDirectory, directory)
      mkdirSync(currentDirectory)
    }
    const rootPath = join(currentDirectory, `\n\u001bFORGED${"\u0001".repeat(180)}`)
    const args = [
      "--experimental-strip-types",
      preflightPath,
      "--dapps-root",
      dappsRoot,
      "--root",
      rootPath,
      "--cam-uri",
      "https://example.invalid/cam.json",
    ]

    const human = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })
    assert.equal(human.status, 1)
    assert.equal(human.stdout, "")
    assert.ok(human.stderr.includes("\\u000a\\u001bFORGED"))
    assert.doesNotMatch(human.stderr, /[\u0000-\u0009\u000b-\u001f\u007f]/)
    assert.doesNotMatch(human.stderr, /^FORGED/m)
    assert.ok(human.stderr.endsWith("...\n"))
    assert.equal(human.stderr.length, "cam-publication-preflight: ".length + 1_000 + 3 + 1)
    assert.equal(human.stderr.split("\n").length, 2)

    const json = spawnSync(process.execPath, [...args, "--json"], { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })
    assert.equal(json.status, 1)
    assert.equal(json.stderr, "")
    assert.deepEqual(JSON.parse(json.stdout), {
      ok: false,
      error: `CAM root does not exist: ${rootPath}`,
    })
  } finally {
    rmSync(dappsRoot, { recursive: true, force: true })
  }
})
