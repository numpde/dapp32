import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("refund worker fails before RPC or signing without explicit file inputs", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./runner.ts", import.meta.url))], { env: {}, encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /stopped during configuration/)
  assert.match(result.stderr, /Missing REFUND_CONFIG_FILE/)
  assert.equal(result.stdout, "")
})

test("duplicate configuration authority fails before RPC without echoing file contents", () => {
  const directory = mkdtempSync(join(tmpdir(), "refund-config-"))
  try {
    const file = join(directory, "config")
    const secretMarker = "DO_NOT_ECHO_CONFIG_CONTENT"
    writeFileSync(file, `{"chainId":"1","chainId":"2","secret":"${secretMarker}"}`, { mode: 0o600 })
    const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./runner.ts", import.meta.url))], { env: { REFUND_CONFIG_FILE: file }, encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unambiguous valid JSON/)
    assert(!result.stderr.includes(secretMarker))
    assert(!result.stderr.includes("RPC_URL_FILE"), "reject duplicate fields before opening RPC configuration")
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
