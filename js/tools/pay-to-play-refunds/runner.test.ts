import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import test from "node:test"

test("refund worker fails before RPC or signing without explicit file inputs", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./runner.ts", import.meta.url))], { env: {}, encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /stopped during configuration/)
  assert.equal(result.stdout, "")
})
