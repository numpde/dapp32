import assert from "node:assert/strict"
import test from "node:test"

import { CAM_VERSION } from "@cam/protocol"
import type { CamDocument, CamRoute } from "@cam/core"
import type { Address } from "viem"

import { CamViewerError } from "../src/errors.ts"
import { assertViewerRouteAccountAvailable } from "../src/route-preflight.ts"

const account = {
  address: "0x0000000000000000000000000000000000000acc" as Address,
}

test("assertViewerRouteAccountAvailable enforces account preflight for route expressions", () => {
  assert.throws(
    () => assertViewerRouteAccountAvailable({
      cam: camDocument(),
      route: "accountRead",
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && error.message === "CAM route requires an account: accountRead",
  )

  assert.doesNotThrow(() => assertViewerRouteAccountAvailable({
    cam: camDocument(),
    route: "accountRead",
    account,
  }))
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
