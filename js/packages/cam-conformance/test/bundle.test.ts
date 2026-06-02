import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import {
  assertCamBundle,
  validateCamBundle,
} from "../src/index.ts"
import type {
  CamConformanceBundle,
} from "../src/index.ts"

const encoder = new TextEncoder()

test("valid minimal bundle returns no issues", () => {
  assert.deepEqual(validateCamBundle(minimalBundle()), [])
  assert.doesNotThrow(() => assertCamBundle(minimalBundle()))
})

test("missing declared UI resource returns one precise issue", () => {
  const bundle = minimalBundle()
  const resources = new Map(bundle.resources)
  resources.delete("./ui.json")

  assert.deepEqual(validateCamBundle({
    ...bundle,
    resources,
  }), [
    {
      rule: "CAM_RESOURCE_MISSING",
      severity: "error",
      resource: "./ui.json",
      path: "namespaces.ui.uri",
      message: "declared CAM resource is missing: ./ui.json",
    },
  ])
})

test("UI resource integrity mismatch returns one precise issue", () => {
  const issues = validateCamBundle(minimalBundle({
    uiIntegrity: "sha256:0x0000000000000000000000000000000000000000000000000000000000000000",
  }))

  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.rule, "CAM_RESOURCE_INTEGRITY_MISMATCH")
  assert.equal(issues[0]?.severity, "error")
  assert.equal(issues[0]?.resource, "./ui.json")
  assert.equal(issues[0]?.path, "namespaces.ui.integrity")
  assert.match(issues[0]?.message ?? "", /CAM resource integrity mismatch/)
})

function minimalBundle(overrides: {
  readonly uiIntegrity?: string
} = {}): CamConformanceBundle {
  const uiBytes = jsonBytes({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Text",
        requires: ["view"],
        props: {
          text: "$view.title",
        },
      },
    },
  })
  const abiBytes = jsonBytes([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [],
    },
  ])
  const mainBytes = jsonBytes({
    cam: "1.0.0",
    entry: "entry",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: sha256Integrity(abiBytes),
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: overrides.uiIntegrity ?? sha256Integrity(uiBytes),
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
  })

  return {
    mainURI: "file:///bundle/main.json",
    mainBytes,
    resources: new Map([
      ["./abi/App.json", abiBytes],
      ["./ui.json", uiBytes],
    ]),
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value))
}

function sha256Integrity(bytes: Uint8Array): string {
  return `sha256:0x${createHash("sha256").update(bytes).digest("hex")}`
}
