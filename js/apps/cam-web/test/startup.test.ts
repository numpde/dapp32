import assert from "node:assert/strict"
import test from "node:test"

import { parseStartupOptions, readStartupPolicy } from "../src/startup.ts"

const POLICY = {
  resourceOrigin: "https://resources.example.test",
  allowUnsignedCamHash: false,
}

test("startup parser rejects duplicate deep-link parameters", () => {
  const url = new URL("https://viewer.example.test/")
  url.searchParams.set("chainId", "eip155:31337")
  url.searchParams.set("host", "0x0000000000000000000000000000000000000001")
  url.searchParams.append("host", "0x0000000000000000000000000000000000000002")
  url.searchParams.set("account", "0x0000000000000000000000000000000000000003")
  url.searchParams.set("rpcUrl", "http://127.0.0.1:8545")

  assert.throws(
    () => parseStartupOptions(url, POLICY),
    /duplicate URL parameter: host/,
  )
})

test("startup policy requires explicit boolean text", () => {
  assert.deepEqual(readStartupPolicy({
    VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test",
    VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH: "false",
  }), POLICY)

  assert.throws(
    () => readStartupPolicy({
      VITE_CAM_WEB_RESOURCE_ORIGIN: "https://resources.example.test",
      VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH: "0",
    }),
    /expected "true" or "false"/,
  )
})
