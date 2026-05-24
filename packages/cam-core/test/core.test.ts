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
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    account: {
      address: "0x0000000000000000000000000000000000000002",
    },
    params: {
      serialNumber: "ABC123",
    },
    state: {},
    outputs: {},
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
    state: {},
    outputs: {},
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
    state: {},
    outputs: {},
  }

  for (const field of ["params", "state", "outputs"] as const) {
    const input = { ...base }
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
      state: {},
      outputs: {},
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
    },
    state: {},
    outputs: {
      count: BigInt(1),
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
        args: ["$params.component.serialNumber", "$outputs.count"],
      },
    },
  })

  assert.deepEqual(resolveRouteCall(cam, "entry", context).args, ["ABC123", BigInt(1)])
})

test("rejects unsupported runtime context values", () => {
  const base = {
    host: {
      chainId: "eip155:31337",
      address: "0x0000000000000000000000000000000000000001",
    },
    params: {},
    state: {},
    outputs: {},
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
      state: {},
      outputs: {},
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
      state: {},
      outputs: {},
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

  assert.deepEqual(cam.routes.entry.args, [{ value: "$params.serialNumber" }])
})

test("keeps contract and route map keys prototype-neutral", () => {
  const cam = parseCam(JSON.parse(`{
    "cam": "1.0.0",
    "name": "Prototype key fixture",
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

test("rejects explicitly undefined optional CAM metadata", () => {
  for (const field of ["$schema", "description"] as const) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        [field]: undefined,
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
})

test("rejects empty required CAM strings", () => {
  for (const field of ["cam", "name", "entry"] as const) {
    assert.throws(
      () => parseCam({
        ...mainJson,
        [field]: "",
      }),
      (error) => error instanceof CamError && error.code === "CAM_INVALID_FIELD",
    )
  }
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
    state: {},
    outputs: {},
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
    state: {},
    outputs: {},
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
