import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fileURLToPath } from "node:url"

test("scenario CLIs reject missing and empty RPC or broadcast configuration", () => {
  const rpcURL = "http://127.0.0.1:1"
  const cases = [
    { name: "missing RPC", env: {}, variable: "PAY_TO_PLAY_SCENARIO_RPC_URL" },
    { name: "empty RPC", env: { PAY_TO_PLAY_SCENARIO_RPC_URL: "" }, variable: "PAY_TO_PLAY_SCENARIO_RPC_URL" },
    { name: "missing broadcast", env: { PAY_TO_PLAY_SCENARIO_RPC_URL: rpcURL }, variable: "PAY_TO_PLAY_SCENARIO_BROADCAST_PATH" },
    { name: "empty broadcast", env: { PAY_TO_PLAY_SCENARIO_RPC_URL: rpcURL, PAY_TO_PLAY_SCENARIO_BROADCAST_PATH: "" }, variable: "PAY_TO_PLAY_SCENARIO_BROADCAST_PATH" },
  ]
  const entrypoints = [
    { script: "./runner.ts", kind: "scenario" },
    { script: "./recovery.ts", kind: "recovery" },
  ] as const

  for (const { script, kind } of entrypoints) {
    const scriptPath = fileURLToPath(new URL(script, import.meta.url))
    for (const scenario of cases) {
      const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath], {
        env: scenario.env,
        encoding: "utf8",
        timeout: 10000,
        maxBuffer: 100000,
      })
      assert.equal(result.status, 1, `${kind} ${scenario.name} must fail configuration`)
      assert.equal(result.stdout, "", `${kind} ${scenario.name} must not emit a success event`)
      if (kind === "scenario") {
        assert.match(result.stderr, new RegExp(scenario.variable), `${scenario.name} must name the missing input`)
      } else {
        assert.equal(result.stderr, "Recovery scenario failed during configuration.\n", `${scenario.name} must retain phase-only recovery errors`)
      }
    }
  }
})
