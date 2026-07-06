import assert from "node:assert/strict"
import test from "node:test"

import { CamError, parseCam } from "@cam/core"
import { CamEvmError } from "@cam/evm-viem"
import { CAM_VERSION, toInertValue, UI_VERSION } from "@cam/protocol"
import { UiError, parseUi } from "@cam/screen"
import type { CamDocument } from "@cam/core"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type { InertRecord } from "@cam/protocol"
import type { UiDocument } from "@cam/screen"
import type { Abi, Address } from "viem"

import { createMockCamPublicClient } from "../../../../tests/fixtures/cam/mock.mts"
import { CamViewerError } from "../src/errors.ts"
import { resolveViewerReadRoute } from "../src/read-resolution.ts"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x00000000000000000000000000000000000000cA",
}
const account = {
  address: "0x0000000000000000000000000000000000000acc" as Address,
}
const contractAddress = "0x00000000000000000000000000000000000000A0" as Address

test("resolveViewerReadRoute resolves values, initial state, and UI", async () => {
  const result = await resolveViewerReadRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({})),
    cam: camDocument(),
    contracts: resolvedContracts(),
    ui: uiDocument(),
    host,
    route: "readRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.equal(result.route, "readRoute")
  assert.deepEqual(toInertValue(result.inputs), toInertValue({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(result.values, toInertValue(["ready"]))
  assert.deepEqual(result.state, toInertValue({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(toInertValue(result.resolvedUi), toInertValue({
    element: "Screen",
    props: {
      title: "Demo",
    },
    children: [
      {
        element: "TextField",
        props: {
          label: "ready",
        },
        state: {
          key: "serialNumber",
        },
        children: [],
      },
    ],
  }))
})

test("resolveViewerReadRoute rejects missing routes", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "missingRoute",
      inputs: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /declared as read/.test(error.message),
  )
})

test("resolveViewerReadRoute rejects write route navigation", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "writeRoute",
      inputs: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /declared as read/.test(error.message),
  )
})

test("resolveViewerReadRoute rejects account-required read routes without an account", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "accountRead",
      inputs: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /requires an account/.test(error.message),
  )
})

test("resolveViewerReadRoute accepts account-required read routes with an account", async () => {
  const result = await resolveViewerReadRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({
      routeResults: {
        readForOwner: account.address,
      },
    })),
    cam: camDocument(),
    contracts: resolvedContracts(),
    ui: uiDocument(),
    host,
    account,
    route: "accountRead",
    inputs: {},
  })

  assert.deepEqual(result.values, toInertValue([account.address]))
})

test("resolveViewerReadRoute passes route inputs to callCamRoute", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))

  await resolveViewerReadRoute({
    publicClient,
    cam: camDocument(),
    contracts: resolvedContracts(),
    ui: uiDocument(),
    host,
    route: "readRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  const routeCall = publicClient.calls.find((call) => call.functionName === "read")
  assert.deepEqual(routeCall?.args, ["ABC123"])
})

test("resolveViewerReadRoute passes route outputs into UI resolution", async () => {
  const result = await resolveViewerReadRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({
      routeResults: {
        read: "from-chain",
      },
    })),
    cam: camDocument(),
    contracts: resolvedContracts(),
    ui: uiDocument(),
    host,
    route: "readRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.deepEqual(toInertValue(result.resolvedUi), toInertValue({
    element: "Screen",
    props: {
      title: "Demo",
    },
    children: [
      {
        element: "TextField",
        props: {
          label: "from-chain",
        },
        state: {
          key: "serialNumber",
        },
        children: [],
      },
    ],
  }))
})

test("resolveViewerReadRoute propagates callCamRoute failures", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({
        routeResults: {},
      })),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "readRoute",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamEvmError
      && error.code === "CAM_ROUTE_CALL_FAILED",
  )
})

test("resolveViewerReadRoute propagates route resolver failures", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "readRoute",
      inputs: {},
    }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "routes.readRoute.inputs",
  )
})

test("resolveViewerReadRoute propagates UI resolution failures", async () => {
  await assert.rejects(
    () => resolveViewerReadRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: camDocument(),
      contracts: resolvedContracts(),
      ui: uiDocument(),
      host,
      route: "badUi",
      inputs: {},
    }),
    (error) => error instanceof UiError
      && error.code === "UI_UNRESOLVED_VALUE",
  )
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
        inputs: ["serialNumber"],
        call: {
          namespace: "contracts.App",
          function: "read",
          args: {
            serialNumber: "$inputs.serialNumber",
          },
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: {
              serialNumber: "$inputs.serialNumber",
              status: "$outputs.0",
            },
          },
        },
      },
      accountRead: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "readForOwner",
          args: {
            owner: "$account.address",
          },
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: {
              serialNumber: "$account.address",
              status: "$outputs.0",
            },
          },
        },
      },
      badUi: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "readStatic",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "strictView",
          args: {},
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
          args: {
            serialNumber: "ABC123",
          },
        },
      },
    },
  })
}

function uiDocument(): UiDocument {
  return parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: ["view"],
        props: {
          title: "Demo",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "$view.status",
            },
            state: {
              key: "serialNumber",
              defaultValue: "$view.serialNumber",
            },
          },
        ],
      },
      strictView: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.status",
        },
      },
    },
  })
}

function resolvedContracts(): Record<string, ResolvedCamContract> {
  return {
    "contracts.App": {
      address: contractAddress,
      abi: appAbi,
    },
  }
}

function createPublicClient({
  chainId,
  routeResults,
}: PublicClientFixtureOptions) {
  return createMockCamPublicClient({
    chainId,
    camURI: "ipfs://example/cam.json",
    camHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    supportsCamInterface: true,
    addresses: {},
    routeResults,
  })
}

type PublicClientFixtureOptions = {
  readonly chainId: number
  readonly routeResults: Record<string, unknown>
}

function publicClientFixtureOptions(overrides: Partial<PublicClientFixtureOptions>): PublicClientFixtureOptions {
  return {
    chainId: 31337,
    routeResults: {
      read: "ready",
      readForOwner: "ready",
      readStatic: "ready",
    },
    ...overrides,
  }
}

const appAbi = [
  {
    type: "function",
    name: "read",
    stateMutability: "view",
    inputs: [{ name: "serialNumber", type: "string" }],
    outputs: [{ name: "status", type: "string" }],
  },
  {
    type: "function",
    name: "readForOwner",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    type: "function",
    name: "readStatic",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "status", type: "string" }],
  },
  {
    type: "function",
    name: "write",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const satisfies Abi
