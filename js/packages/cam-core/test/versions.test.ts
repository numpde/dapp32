import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_VERSION,
} from "@cam/protocol"

import {
  CamError,
  parseCam,
} from "../src/index.ts"

function camDocument(version: unknown): Record<string, unknown> {
  return {
    cam: version,
    protocol: { uri: "./protocol.html", integrity: "sha256:fixture" },
    entry: "entry",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: "sha256:fixture",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: "sha256:fixture",
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "viewEntry",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$outputs.0",
          },
        },
      },
    },
  }
}

test("parseCam preserves the current document version", () => {
  assert.equal(parseCam(camDocument("1.3.0")).cam, "1.3.0")
})

test("parseCam rejects unsupported versions", () => {
  assert.throws(
    () => parseCam(camDocument("2.0.0")),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "cam"
      && error.message === "cam: unsupported CAM version: 2.0.0",
  )
})

test("parseCam rejects retired CAM 1.0, 1.1, and 1.2 documents", () => {
  for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
    assert.throws(
      () => parseCam(camDocument(version)),
      (error) =>
        error instanceof CamError
        && error.code === "CAM_INVALID_FIELD"
        && error.path === "cam"
        && error.message === `cam: unsupported CAM version: ${version}`,
    )
  }
})


test("CAM 1.3 requires a closed protocol resource declaration with secondary URI policy", () => {
  for (const protocol of [undefined, null, {}, { uri: "./protocol.html" }, { uri: "https://example.com/protocol", integrity: "sha256:fixture" }, { uri: "./protocol.html", integrity: "sha256:fixture", extra: true }]) {
    assert.throws(() => parseCam({ ...camDocument(CAM_VERSION), protocol }), CamError)
  }
  const protocol = { uri: "./protocol.html", integrity: "sha256:fixture" }
  assert.deepEqual(parseCam({ ...camDocument(CAM_VERSION), protocol }).protocol, protocol)
})
