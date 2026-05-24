import assert from "node:assert/strict"
import test from "node:test"

import {
  CamError,
  createContext,
  parseCam,
  resolveResourceURI,
  resolveRouteCall,
  resolveValue,
} from "../src/index.ts"

const mainJson = {
  $schema: "https://cam.example/schemas/cam-1.json",
  cam: "1.0.0",
  name: "Bicycle Registry",
  description: "Register and verify bicycle components by serial number.",
  entry: "entry",
  contracts: {
    BicycleComponentManagerUI: {
      abiURI: "./abi/IBicycleComponentManagerUI.v1.json",
    },
    BicycleComponentManager: {
      abiURI: "./abi/IBicycleComponentManager.v1.json",
    },
  },
  routes: {
    entry: {
      contract: "BicycleComponentManagerUI",
      function: "viewEntry",
      args: ["$account.address"],
    },
    component: {
      contract: "BicycleComponentManagerUI",
      function: "viewComponent",
      args: ["$params.serialNumber", "$account.address"],
    },
  },
}

test("resolves a CAM route into a plain call descriptor", () => {
  const cam = parseCam(mainJson)
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    account: {
      address: "0x0000000000000000000000000000000000000002",
    },
    params: {
      serialNumber: "ABC123",
    },
  })

  const call = resolveRouteCall(cam, "component", context)

  assert.deepEqual(call, {
    contract: "BicycleComponentManagerUI",
    function: "viewComponent",
    args: [
      "ABC123",
      "0x0000000000000000000000000000000000000002",
    ],
  })
})

test("keeps non-expression strings literal", () => {
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
  })

  assert.equal(resolveValue("Price: $5", context), "Price: $5")
})

test("rejects missing required host context", () => {
  assert.throws(
    () => createContext({
      host: {
        address: "0x0000000000000000000000000000000000000001",
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )

  assert.throws(
    () => createContext({
      host: {
        chainId: "eip155:31337",
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )

  assert.throws(
    () => createContext({
      host: {
        chainId: "",
        address: "0x0000000000000000000000000000000000000001",
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("rejects invalid expression syntax", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        entry: {
          contract: "BicycleComponentManagerUI",
          function: "viewEntry",
          args: ["$account[address]"],
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_EXPRESSION",
  )
})

test("rejects unresolved expression values", () => {
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

test("rejects old contract address fields", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      contracts: {
        BicycleComponentManagerUI: {
          abiURI: "./abi/IBicycleComponentManagerUI.v1.json",
          address: "0x0000000000000000000000000000000000000001",
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("rejects old route resolver and screen fields", () => {
  for (const field of ["resolver", "screenURI"]) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        routes: {
          entry: {
            contract: "BicycleComponentManagerUI",
            function: "viewEntry",
            [field]: "./screen.json",
          },
        },
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects wallet hints in core V1 documents", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      wallet: {
        connect: true,
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("resolves resource URIs without fetching", () => {
  assert.equal(
    resolveResourceURI("./main.json", "./abi/IBicycleComponentManager.v1.json"),
    "./abi/IBicycleComponentManager.v1.json",
  )
  assert.equal(
    resolveResourceURI("ipfs://bafyRoot/main.json", "./abi/IBicycleComponentManager.v1.json"),
    "ipfs://bafyRoot/abi/IBicycleComponentManager.v1.json",
  )
})
