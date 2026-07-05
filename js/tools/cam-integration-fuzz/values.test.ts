import assert from "node:assert/strict"
import test from "node:test"

import type {
  CamRoute,
} from "../../packages/cam-core/dist/index.js"
import type {
  Address,
} from "viem"
import type {
  Prng,
} from "./prng.ts"
import {
  generatedRouteInputs,
} from "./values.ts"

const account = "0x0000000000000000000000000000000000000001" as Address

test("broad value generation keeps invalid empty strings in the read-only corpus", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["serialNumber", "note"]),
      account,
      prng: firstValuePrng(),
      mode: "broad",
    })),
    {
      serialNumber: "",
      note: "",
    },
  )
})

test("write-positive value generation avoids known-invalid empty strings", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["serialNumber", "note"]),
      account,
      prng: firstValuePrng(),
      mode: "write-positive",
    })),
    {
      serialNumber: "CAM-TEST-001",
      note: "CAM-TEST-001",
    },
  )
})

test("value generation treats account and URI-like names as protocol fixtures", () => {
  assert.deepEqual(
    plainRecord(generatedRouteInputs({
      route: routeWithInputs(["ownerAddress", "metadataURI"]),
      account,
      prng: firstValuePrng(),
      mode: "broad",
    })),
    {
      ownerAddress: account,
      metadataURI: "fixture://cam-integration/1.json",
    },
  )
})

function plainRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record))
}

function routeWithInputs(inputs: readonly string[]): CamRoute {
  return {
    kind: "read",
    inputs,
    call: {
      namespace: "routes",
      function: "view",
      args: {},
    },
    then: {
      namespace: "ui",
      function: "render",
      args: {},
    },
  }
}

function firstValuePrng(): Prng {
  return {
    integer() {
      return 0
    },
    pick(values) {
      const value = values[0]
      if (value === undefined) {
        throw new Error("test PRNG cannot pick from an empty array")
      }
      return value
    },
  }
}
