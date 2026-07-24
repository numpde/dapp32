import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_SUPPORTED_VERSIONS,
} from "@cam/protocol"

import {
  CamError,
  parseCam,
} from "../src/index.ts"

function camDocument(version: unknown): Record<string, unknown> {
  return {
    cam: version,
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

test("parseCam preserves every supported document version", () => {
  for (const version of CAM_SUPPORTED_VERSIONS) {
    assert.equal(parseCam(camDocument(version)).cam, version)
  }
})

test("parseCam still rejects versions outside the supported inventory", () => {
  assert.throws(
    () => parseCam(camDocument("2.0.0")),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "cam"
      && error.message === "unsupported CAM version: 2.0.0",
  )
})
