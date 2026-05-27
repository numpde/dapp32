import assert from "node:assert/strict"
import test from "node:test"

import * as camCore from "../src/index.ts"
import {
  CamError,
  createContext,
  parseCam,
  resolveResourceURI,
  resolveRouteCall,
} from "../src/index.ts"
import {
  parseJsonText,
  toInertValue,
} from "@cam/protocol"
import {
  BIKE_ACCOUNT_ADDRESS,
  BIKE_HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID,
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
  BIKE_UI_CONTRACT,
  BIKE_VIEW_COMPONENT,
  bikeCamJson as mainJson,
} from "../../../tests/fixtures/cam/bike.mts"

test("keeps the public API to the CAM core boundary", () => {
  assert.deepEqual(Object.keys(camCore).sort(), [
    "CamError",
    "createContext",
    "parseCam",
    "resolveResourceURI",
    "resolveRouteCall",
  ])
})

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

test("keeps non-expression strings literal", () => {
  const cam = parseCam({
    ...mainJson,
    routes: {
      entry: {
        contract: "BicycleComponentManagerUI",
        function: "viewEntry",
        args: ["Price: $5"],
      },
    },
  })
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {},
  })

  assert.deepEqual(resolveRouteCall(cam, "entry", context).args, ["Price: $5"])
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

test("rejects missing required context records", () => {
  const base = {
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {},
  }

  for (const field of ["params"] as const) {
    const input: Partial<typeof base> = { ...base }
    delete input[field]

    assert.throws(
      () => createContext(input),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects non-JSON record objects", () => {
  assert.throws(
    () => parseCam(new Date()),
    (error) => error instanceof CamError && error.code === "CAM_NOT_OBJECT",
  )

  assert.throws(
    () => createContext({
      host: {
        chainId: "eip155:31337",
        address: "0x0000000000000000000000000000000000000001",
      },
      params: new Date(),
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("copies nested runtime context records", () => {
  const input = {
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {
      component: {
        serialNumber: "ABC123",
      },
      count: 1,
    },
  }

  const context = createContext(input)

  input.params.component.serialNumber = "CHANGED"

  const cam = parseCam({
    ...mainJson,
    routes: {
      entry: {
        contract: "BicycleComponentManagerUI",
        function: "viewEntry",
        args: ["$params.component.serialNumber", "$params.count"],
      },
    },
  })

  assert.deepEqual(resolveRouteCall(cam, "entry", context).args, ["ABC123", 1])
})

test("rejects unsupported runtime context values", () => {
  const base = {
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {},
  }
  const invalidValues = [
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
    () => undefined,
    Symbol("value"),
  ]

  for (const value of invalidValues) {
    assert.throws(
      () => createContext({
        ...base,
        params: {
          value,
        },
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects account context without an address", () => {
  assert.throws(
    () => createContext({
      host: {
        chainId: "eip155:31337",
        address: "0x0000000000000000000000000000000000000001",
      },
      account: {},
      params: {},
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("rejects explicitly undefined optional context fields", () => {
  assert.throws(
    () => createContext({
      host: {
        chainId: "eip155:31337",
        address: "0x0000000000000000000000000000000000000001",
      },
      account: undefined,
      params: {},
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("rejects renderer-owned context fields", () => {
  for (const field of ["state", "outputs"] as const) {
    assert.throws(
      () => createContext({
        host: {
          chainId: "eip155:31337",
          address: "0x0000000000000000000000000000000000000001",
        },
        params: {},
        [field]: {},
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
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

test("rejects unknown expression roots while parsing", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        entry: {
          contract: "BicycleComponentManagerUI",
          function: "viewEntry",
          args: ["$wallet.address"],
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_EXPRESSION",
  )
})

test("rejects route args that cannot exist in JSON", () => {
  const invalidArgs = [
    new Date(),
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    () => undefined,
    Symbol("arg"),
    BigInt(1),
  ]

  for (const value of invalidArgs) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        routes: {
          entry: {
            contract: "BicycleComponentManagerUI",
            function: "viewEntry",
            args: [value],
          },
        },
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects sparse route arg arrays", () => {
  const args = ["present", "missing"] as unknown[]
  delete args[1]

  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        entry: {
          contract: "BicycleComponentManagerUI",
          function: "viewEntry",
          args,
        },
      },
    }),
    (error) =>
      error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "routes.entry.args.1",
  )
})

test("requires explicit route args arrays", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      routes: {
        entry: {
          contract: "BicycleComponentManagerUI",
          function: "viewEntry",
        },
      },
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )

  assert.deepEqual(
    parseCam({
      ...mainJson,
      routes: {
        entry: {
          contract: "BicycleComponentManagerUI",
          function: "viewEntry",
          args: [],
        },
      },
    }).routes.entry.args,
    [],
  )
})

test("copies route args out of the input document", () => {
  const input = {
    ...mainJson,
    routes: {
      entry: {
        contract: "BicycleComponentManagerUI",
        function: "viewEntry",
        args: [{ value: "$params.serialNumber" }],
      },
    },
  }

  const cam = parseCam(input)

  input.routes.entry.args[0].value = "$params.changed"

  assert.deepEqual(cam.routes.entry.args, [toInertValue({ value: "$params.serialNumber" })])
})

test("keeps contract and route map keys prototype-neutral", () => {
  const cam = parseCam(parseJsonText(`{
    "cam": "1.0.0",
    "entry": "__proto__",
    "contracts": {
      "__proto__": {
        "abiURI": "./abi/proto.json"
      }
    },
    "routes": {
      "__proto__": {
        "contract": "__proto__",
        "function": "viewEntry",
        "args": []
      }
    }
  }`))

  assert.equal(Object.getPrototypeOf(cam.contracts), null)
  assert.equal(Object.getPrototypeOf(cam.routes), null)
  assert.deepEqual(cam.contracts.__proto__, { abiURI: "./abi/proto.json" })
  assert.deepEqual(cam.routes.__proto__, {
    contract: "__proto__",
    function: "viewEntry",
    args: [],
  })
})

test("rejects display metadata in core CAM documents", () => {
  for (const field of ["$schema", "name", "description"] as const) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        [field]: "metadata belongs above core",
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects empty required CAM strings", () => {
  for (const field of ["cam", "entry"] as const) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        [field]: "",
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects unsupported CAM versions", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      cam: "2.0.0",
    }),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
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

test("rejects inherited route names", () => {
  const cam = {
    ...parseCam(mainJson),
    routes: {},
  }
  const context = createContext({
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {},
  })

  assert.throws(
    () => resolveRouteCall(cam, "toString", context),
    (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
  )
})

test("rejects old contract address fields", () => {
  assert.throws(
    () => parseCam({
      ...mainJson,
      contracts: {
        BicycleComponentManagerUI: {
          abiURI: "./abi/BicycleComponentManagerUI.json",
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
    resolveResourceURI("./main.json", "./abi/BicycleComponentManager.json"),
    "./abi/BicycleComponentManager.json",
  )
  assert.equal(
    resolveResourceURI("ipfs://bafyRoot/main.json", "./abi/BicycleComponentManager.json"),
    "ipfs://bafyRoot/abi/BicycleComponentManager.json",
  )
})
