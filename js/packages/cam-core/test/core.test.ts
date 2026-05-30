import assert from "node:assert/strict"
import test from "node:test"

import {
  CamError,
  createContext,
  parseCam,
  resolveRouteCall,
} from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID,
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
  BIKE_UI_CONTRACT,
  BIKE_VIEW_COMPONENT,
  bikeCamJson as mainJson,
} from "../../../../tests/fixtures/cam/bike.mts"

test("resolves a CAM route into a plain call descriptor", () => {
  const cam = parseCam(mainJson)
  const context = createContext({
    host: {
      chainId: BIKE_HOST_CHAIN_ID,
      address: BIKE_HOST_ADDRESS,
    },
    account: {
      address: BIKE_ACCOUNT_ADDRESS,
    },
    params: {
      serialNumber: BIKE_SERIAL_NUMBER,
    },
  })

  const call = resolveRouteCall(cam, BIKE_ROUTE_COMPONENT, context)

  assert.deepEqual(call, {
    contract: BIKE_UI_CONTRACT,
    function: BIKE_VIEW_COMPONENT,
    args: [
      BIKE_SERIAL_NUMBER,
      BIKE_ACCOUNT_ADDRESS,
    ],
  })
})

test("rejects invalid CAM versions and unresolved route expressions", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      cam: "2.0.0",
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )

  const cam = parseCam(mainJson)
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {
      serialNumber: "ABC123",
    },
  })

  assert.throws(
    () => resolveRouteCall(cam, "component", context),
    (error) => error instanceof CamError && error.code === "CAM_UNRESOLVED_VALUE",
  )
})
