import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { CAM_VERSION } from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { Address } from "viem"

import { CamViewerError } from "../src/errors.ts"
import { requireViewerRoute } from "../src/route-preflight.ts"

const account = {
  address: "0x0000000000000000000000000000000000000acc" as Address,
}

test("requireViewerRoute returns matching viewer routes", () => {
  const route = requireViewerRoute({
    cam: camDocument(),
    route: "readRoute",
    kind: "read",
    missingMessage: "missing read route",
    wrongKindMessage: "wrong route kind",
  })

  assert.equal(route.kind, "read")
})

test("requireViewerRoute separates missing routes from wrong route kinds", () => {
  assert.throws(
    () => requireViewerRoute({
      cam: camDocument(),
      route: "missingRoute",
      kind: "read",
      missingMessage: "missing read route",
      wrongKindMessage: "wrong route kind",
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && error.message === "missing read route",
  )

  assert.throws(
    () => requireViewerRoute({
      cam: camDocument(),
      route: "writeRoute",
      kind: "read",
      missingMessage: "missing read route",
      wrongKindMessage: "wrong route kind",
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && error.message === "wrong route kind",
  )
})

test("requireViewerRoute enforces account preflight for route expressions", () => {
  assert.throws(
    () => requireViewerRoute({
      cam: camDocument(),
      route: "accountRead",
      kind: "read",
      missingMessage: "missing read route",
      wrongKindMessage: "wrong route kind",
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && error.message === "CAM route requires an account: accountRead",
  )

  assert.equal(requireViewerRoute({
    cam: camDocument(),
    route: "accountRead",
    kind: "read",
    account,
    missingMessage: "missing read route",
    wrongKindMessage: "wrong route kind",
  }).kind, "read")
})

function camDocument(): CamDocument {
  return parseCam({
    cam: CAM_VERSION,
    entry: "readRoute",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./cam/abi/App.json",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./cam/ui.json",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    },
    routes: {
      readRoute: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "read",
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
      accountRead: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "read",
          args: {
            owner: "$account.address",
          },
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$outputs.0",
          },
        },
      },
      writeRoute: {
        kind: "write",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "write",
          args: {},
        },
        then: {
          namespace: "routes",
          function: "readRoute",
          args: {},
        },
      },
    },
  })
}
