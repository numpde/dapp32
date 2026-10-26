import assert from "node:assert/strict"
import { open, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createConnection, isIP } from "node:net"
import { rehearsalApp } from "./fixture.ts"

if (process.argv.length !== 4) throw new Error("Pass the app and the running fixture node IPv4 address")
const app = rehearsalApp(process.argv[2])
const rpcAddress = process.argv[3]
assert.equal(isIP(rpcAddress), 4, "Pass the running fixture node's IPv4 address")

for (const path of [
  "/input/js/package.json",
  "/work/js/node_modules/viem/package.json",
]) {
  await assert.rejects(() => open(path, "r+"), { code: "EROFS" }, `Source must be read-only: ${path}`)
}
for (const path of ["/run/secrets/deployer_private_key", "/run/inputs/rpc_url", "/release-broadcast", "/release-artifact"]) {
  await assert.rejects(() => readFile(path), { code: "ENOENT" }, `Planner must not receive ${path}`)
}
await assert.rejects(() => readdir("/work/dapps"), { code: "ENOENT" }, "Business planning has no Solidity or CAM source input")
await assert.rejects(() => open("/out/planner-root-write", "wx"), { code: "EROFS" })
for (const name of ["PRIVATE_KEY", "RPC_URL", "RPC_URL_FILE", "DEPLOYER_PRIVATE_KEY_FILE"]) {
  assert.equal(process.env[name], undefined, `Planner must not inherit ${name}`)
}

await assert.rejects(() => new Promise<void>((resolve, reject) => {
  const socket = createConnection({ host: rpcAddress, port: 8545, timeout: 1000 })
  socket.once("connect", () => { socket.destroy(); resolve() })
  socket.once("error", reject)
  socket.once("timeout", () => socket.destroy(new Error("Fixture connection timed out instead of being denied")))
}), { code: "ENETUNREACH" }, "Planner must not reach the running fixture node")

const canary = "/release-plan/planner-write-check"
try {
  await writeFile(canary, "planner output", { flag: "wx", mode: 0o600 })
  assert.equal(await readFile(canary, "utf8"), "planner output")
} finally {
  await rm(canary, { force: true })
}
process.stdout.write(`${JSON.stringify({ event: "release_planner_boundary_check", app })}\n`)
