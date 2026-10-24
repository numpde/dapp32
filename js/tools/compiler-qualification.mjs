import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { constants } from "node:os"
import { performance } from "node:perf_hooks"

// The existing workspace lane supplies fresh source and no compiler cache.
// Kernel cgroup metrics include its setup and tmpfs, not just the compiler PID.
const compiler = "./node_modules/.bin/tsc"
const steps = [
  ["Compiler version", compiler, ["--version"]],
  ["Package builds", "npm", ["run", "build:packages"]],
  ["Full web app and test typecheck", compiler,
    ["-p", "apps/cam-web/tsconfig.test.json", "--skipLibCheck", "false", "--extendedDiagnostics"]],
]

console.log("Scope: package builds, then full web app/test typechecking; fresh staged workspace, no compiler cache.")
console.log("Each command has a 120-second deadline. OS page caches are not cleared.")
const started = performance.now()
let exitCode = 0
for (const [label, command, args] of steps) {
  console.log(`\n${label}`)
  const child = spawnSync(command, args, { stdio: "inherit", timeout: 120_000, killSignal: "SIGKILL" })
  if (child.error !== undefined) {
    console.error(`Cannot complete ${label}: ${child.error.message}`)
  }
  if (child.signal !== null) {
    console.error(`${label} terminated by ${child.signal}.`)
    exitCode = 128 + constants.signals[child.signal]
  } else if (child.error !== undefined) {
    exitCode = 1
  } else if (child.status !== 0) {
    console.error(`${label} failed with exit status ${child.status}.`)
    exitCode = child.status ?? 1
  }
  if (exitCode !== 0) break
}
console.log(`\nWorkload elapsed: ${((performance.now() - started) / 1000).toFixed(2)} seconds`)
try {
  const peak = cgroupBytes("memory.peak")
  const limit = cgroupBytes("memory.max")
  console.log(`Whole-container peak: ${peak} bytes (${(peak / 1048576).toFixed(1)} MiB)`)
  console.log(`Container limit: ${limit} bytes (${(limit / 1048576).toFixed(1)} MiB)`)
  console.log("Peak includes dependency verification, source staging and tmpfs; it is not compiler-process RSS.")
} catch (error) {
  console.error("Cannot report compiler qualification memory:", error)
  if (exitCode === 0) exitCode = 1
}
console.log(`Outcome: ${exitCode === 0 ? "PASS" : "FAIL"}`)
process.exitCode = exitCode

function cgroupBytes(name) {
  const text = readFileSync(`/sys/fs/cgroup/${name}`, "utf8").trim()
  const bytes = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error(`cgroup v2 ${name} does not contain a positive byte count`)
  }
  return bytes
}
