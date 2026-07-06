import assert from "node:assert/strict"
import test from "node:test"

import { CAM_VERSION } from "@cam/protocol"
import type { CamDocument, CamRoute } from "@cam/core"
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
  return {
    cam: CAM_VERSION,
    entry: "readRoute",
    namespaces: {},
    routes: {
      readRoute: route("read", {}),
      accountRead: route("read", {
        owner: "$account.address",
      }),
      writeRoute: route("write", {}),
    },
  }
}

function route(kind: CamRoute["kind"], callArgs: CamRoute["call"]["args"]): CamRoute {
  return {
    kind,
    inputs: [],
    call: {
      namespace: "contracts.App",
      function: kind === "read" ? "read" : "write",
      args: callArgs,
    },
    then: {
      namespace: kind === "read" ? "ui" : "routes",
      function: kind === "read" ? "app" : "readRoute",
      args: {},
    },
  }
}
