import assert from "node:assert/strict"
import test from "node:test"

import {
  CAM_SUPPORTED_VERSIONS,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
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

test("conformance preserves the root version on every declared route", () => {
  for (const expectedVersion of CAM_SUPPORTED_VERSIONS) {
    const root = rootDocument(expectedVersion)
    const issues: CamConformanceIssue[] = []
    const version = validateRootManifest({
      resource: "cam",
      root,
      issues,
    })

    assert.equal(version, expectedVersion)
    assert.notEqual(version, undefined)
    if (version === undefined) continue

    const namespaces = validateNamespaceDeclarations({
      resource: "cam",
      root,
      issues,
    })
    const routes = validateRouteDeclarations({
      resource: "cam",
      root,
      version,
      namespaces,
      issues,
    })

    assert.deepEqual(issues, [])
    assert.deepEqual(routes.map((route) => ({
      name: route.name,
      version: route.version,
    })), [{
      name: "entry",
      version: expectedVersion,
    }])
  }
})

test("conformance rejects unsupported versions before route inventory", () => {
  const root = rootDocument("2.0.0")
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
    "unsupported CAM version: 2.0.0",
  ]])
})
