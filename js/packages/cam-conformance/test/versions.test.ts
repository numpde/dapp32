import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_SUPPORTED_VERSIONS,
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../src/index.ts"
import {
  validateCamBundle,
} from "../src/index.ts"
import {
  validateNamespaceDeclarations,
} from "../src/manifest/namespaces.ts"
import {
  validateRootManifest,
} from "../src/manifest/root.ts"
import {
  validateRouteDeclarations,
} from "../src/manifest/routes.ts"
import {
  jsonBytes,
  minimalBundle,
} from "./fixtures.ts"

function rootDocument(version: unknown): Record<string, unknown> {
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

test("bundle conformance accepts each supported CAM version", () => {
  for (const version of CAM_SUPPORTED_VERSIONS) {
    const bundle = minimalBundle()
    const root = parseJsonBytes(bundle.rootBytes)
    assert.equal(isRecordObject(root), true)
    if (!isRecordObject(root)) continue

    root.cam = version
    assert.deepEqual(validateCamBundle({
      ...bundle,
      rootBytes: jsonBytes(root),
    }), [])
  }
})

test("conformance rejects unsupported versions before route inventory", () => {
  for (const rejectedVersion of ["1.0.0", "1.1.0", "2.0.0"]) {
    const root = rootDocument(rejectedVersion)
    const issues: CamConformanceIssue[] = []
    const version = validateRootManifest({
      resource: "cam",
      root,
      issues,
    })

    assert.equal(version, undefined)
    assert.deepEqual(issues.map((issue) => [
      issue.rule,
      issue.path,
      issue.message,
    ]), [[
      "CAM_MANIFEST_VERSION_INVALID",
      "cam",
      `unsupported CAM version: ${rejectedVersion}`,
    ]])
  }
})
