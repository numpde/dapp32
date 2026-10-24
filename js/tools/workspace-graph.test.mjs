import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import test from "node:test"

test("workspace admission rejects root toolchain drift before running the command", () => {
  assert.equal(process.cwd(), "/work/js", "this probe may mutate only the container-staged manifest")
  const original = readFileSync("package.json")
  const manifest = JSON.parse(original)
  const marker = "workspace-graph-downstream"
  // The fixture is already staged. Keep the real gate and npm, replacing only restaging.
  const command = String.raw`stage-js-workspace() { :; }; export -f stage-js-workspace; exec bash /usr/local/bin/run-js-workspace printf '%s\n' workspace-graph-downstream`
  const probe = () => spawnSync("bash", ["-c", command], {
    encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    env: { ...process.env, BASH_ENV: "/dev/null" },
  })
  try {
    manifest.devDependencies.typescript = "0.0.0-workspace-probe"
    writeFileSync("package.json", JSON.stringify(manifest))
    const rejected = probe()
    assert.equal(rejected.error, undefined)
    assert.notEqual(rejected.status, 0, "a mismatched root compiler must not be admitted")
    assert.equal(rejected.stdout.includes(marker), false)
    assert.match(rejected.stderr, /typescript/)
  } finally {
    writeFileSync("package.json", original)
  }
  const accepted = probe()
  assert.equal(accepted.error, undefined)
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(accepted.stdout.trim(), marker)
})
