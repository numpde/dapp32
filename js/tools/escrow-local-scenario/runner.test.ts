import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

test("scenario startup rejects absent or empty required connection inputs before RPC or signing", () => {
  const runner = fileURLToPath(new URL("./runner.ts", import.meta.url))
  const cases = [
    { env: {}, name: "ESCROW_SCENARIO_RPC_URL" },
    { env: { ESCROW_SCENARIO_RPC_URL: "" }, name: "ESCROW_SCENARIO_RPC_URL" },
    { env: { ESCROW_SCENARIO_RPC_URL: "http://127.0.0.1:8545" }, name: "ESCROW_SCENARIO_RESOURCE_ORIGIN" },
    { env: { ESCROW_SCENARIO_RPC_URL: "http://127.0.0.1:8545", ESCROW_SCENARIO_RESOURCE_ORIGIN: "" }, name: "ESCROW_SCENARIO_RESOURCE_ORIGIN" },
  ] as const

  for (const { env, name } of cases) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", runner], {
      env,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 100000,
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(`missing required environment variable: ${name}`))
    assert.equal(result.stdout, "")
  }
})
