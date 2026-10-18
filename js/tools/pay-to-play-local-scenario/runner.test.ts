import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

test("scenario startup reports its missing input and exits before RPC or signing", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./runner.ts", import.meta.url))], { env: {}, encoding: "utf8", timeout: 10000, maxBuffer: 100000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /PAY_TO_PLAY_SCENARIO_RPC_URL/)
  assert.equal(result.stdout, "")
})

test("recovery scenario requires explicit fixture configuration before RPC or signing", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./recovery.ts", import.meta.url))], { env: {}, encoding: "utf8", timeout: 10000, maxBuffer: 100000 })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Recovery scenario failed during configuration/)
  assert.equal(result.stdout, "")
})
