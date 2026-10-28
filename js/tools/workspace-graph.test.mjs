import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
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

test("refresh removes stale staged code while preserving the viewer working directory and dependencies", () => {
  assert.equal(process.cwd(), "/work/js", "refresh may mutate only the container-staged workspace")
  const viewer = "/work/js/apps/cam-web"
  const viewerInode = statSync(viewer).ino
  const modulesInode = statSync("node_modules").ino
  const staleFiles = [`${viewer}/src/.refresh-probe`, `${viewer}/dist/.refresh-probe`]
  const appSource = readFileSync("/input/js/apps/cam-web/src/App.tsx")
  try {
    for (const file of staleFiles) {
      mkdirSync(file.slice(0, file.lastIndexOf("/")), { recursive: true })
      writeFileSync(file, "stale staged content")
    }
    const refreshed = spawnSync("sh", ["/usr/local/bin/run-js-workspace", "--refresh", "printf", "%s", "refresh-admitted"], {
      cwd: viewer, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024,
    })
    assert.equal(refreshed.error, undefined)
    assert.equal(refreshed.status, 0, refreshed.stderr)
    assert.equal(refreshed.stdout, "refresh-admitted")
    assert.equal(statSync(viewer).ino, viewerInode, "the active Vite working directory must retain its identity")
    assert.equal(statSync("node_modules").ino, modulesInode)
    for (const file of staleFiles) assert(!existsSync(file), "source and build residues must disappear")
    assert(!existsSync(`${viewer}/src/src`), "refresh must not nest source directories")
    assert.deepEqual(readFileSync(`${viewer}/src/App.tsx`), appSource)
  } finally {
    for (const file of staleFiles) rmSync(file, { force: true })
  }
})
