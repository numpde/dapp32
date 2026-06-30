import assert from "node:assert/strict"
import test from "node:test"

import { allowedHosts } from "../vite.config.js"

test("Vite dev host allowlist defaults to loopback hosts only", () => {
  assert.deepEqual(allowedHosts({}), ["127.0.0.1", "localhost"])
})

test("Vite dev host allowlist adds only the declared GUI origin host", () => {
  assert.deepEqual(allowedHosts({ CAM_WEB_DEV_ORIGIN: "http://viewer.example.test:5173" }), [
    "127.0.0.1",
    "localhost",
    "viewer.example.test",
  ])
  assert.deepEqual(allowedHosts({ CAM_WEB_DEV_ORIGIN: "http://localhost:5173" }), ["127.0.0.1", "localhost"])
})

test("Vite dev origin policy rejects ambiguous URL shapes", () => {
  const rejected = [
    "ftp://viewer.example.test",
    "http://user@viewer.example.test",
    "http://viewer.example.test/app",
    "http://viewer.example.test?debug=1",
    "http://viewer.example.test#section",
  ]

  for (const origin of rejected) {
    assert.throws(() => allowedHosts({ CAM_WEB_DEV_ORIGIN: origin }), /CAM_WEB_DEV_ORIGIN/)
  }
})
