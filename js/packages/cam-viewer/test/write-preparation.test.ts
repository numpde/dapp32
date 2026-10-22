import assert from "node:assert/strict"
import test from "node:test"

import { CamError, parseCam } from "@cam/core"
import { CAM_VERSION, InertValueError, toInertValue } from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type { Abi, Address } from "viem"

import { CamViewerError } from "../src/errors.ts"
import { prepareViewerContractCall } from "../src/write-preparation.ts"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x00000000000000000000000000000000000000cA",
}
const account = {
  address: "0x0000000000000000000000000000000000000aCc" as Address,
}
const contractAddress = "0x00000000000000000000000000000000000000a0" as Address
const publicClient = {
  async getChainId(): Promise<never> { assert.fail("static write preparation must not call RPC") },
  async readContract(): Promise<never> { assert.fail("static write preparation must not read a contract") },
}

test("prepareViewerContractCall prepares a write route call", async () => {
  const contracts = resolvedContracts()
  const call = await prepareViewerContractCall({
    publicClient,
    cam: camDocument(),
    contracts,
    host,
    route: "writeRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.equal(call.route, "writeRoute")
  assert.equal(call.address, contractAddress)
  assert.equal(call.function, "write")
  assert.deepEqual(call.args, toInertValue({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(call.then, toInertValue({
    namespace: "routes",
    function: "readRoute",
    args: toInertValue({
      serialNumber: "ABC123",
    }),
  }))
  assert.deepEqual(call.abi, toInertValue(contracts["contracts.App"]?.abi))
})

test("prepareViewerContractCall rejects missing routes", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts: resolvedContracts(),
      host,
      route: "missingRoute",
      inputs: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /does not exist/.test(error.message),
  )
})

test("prepareViewerContractCall rejects read routes", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts: resolvedContracts(),
      host,
      route: "readRoute",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /declared as write/.test(error.message),
  )
})

test("prepareViewerContractCall rejects account-required write routes without an account", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts: resolvedContracts(),
      host,
      route: "accountWrite",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /requires an account/.test(error.message),
  )
})

test("prepareViewerContractCall accepts account-required write routes with an account", async () => {
  const call = await prepareViewerContractCall({
    publicClient,
    cam: camDocument(),
    contracts: resolvedContracts(),
    host,
    account,
    route: "accountWrite",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.deepEqual(call.args, toInertValue({
    owner: account.address,
    serialNumber: "ABC123",
  }))
  assert.deepEqual(call.then.args, toInertValue({
    owner: account.address,
  }))
})

test("prepareViewerContractCall propagates route call resolver failures", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts: resolvedContracts(),
      host,
      route: "writeRoute",
      inputs: {},
    }),
    (error) => error instanceof CamError
      && error.code === "CAM_INVALID_FIELD"
      && error.path === "routes.writeRoute.inputs",
  )
})

test("prepareViewerContractCall rejects non-contract call namespaces", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camWithWriteCallNamespace("ui"),
      contracts: resolvedContracts(),
      host,
      route: "writeRoute",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /must call a contract namespace/.test(error.message),
  )
})

test("prepareViewerContractCall rejects unresolved contract namespaces", async () => {
  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts: {},
      host,
      route: "writeRoute",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /unresolved namespace/.test(error.message),
  )
})

test("prepareViewerContractCall clones prepared payload data", async () => {
  const contracts = resolvedContracts()
  const cam = camDocument()
  const first = await prepareViewerContractCall({
    publicClient,
    cam,
    contracts,
    host,
    route: "writeRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  ;(first.abi as unknown as unknown[]).push({
    type: "function",
    name: "mutated",
    stateMutability: "view",
    inputs: [],
    outputs: [],
  })
  ;(first.args as Record<string, unknown>).serialNumber = "MUTATED"
  ;(first.then.args as Record<string, unknown>).serialNumber = "MUTATED"

  const second = await prepareViewerContractCall({
    publicClient,
    cam,
    contracts,
    host,
    route: "writeRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.notEqual(first.abi, contracts["contracts.App"]?.abi)
  assert.deepEqual(second.abi, toInertValue(contracts["contracts.App"]?.abi))
  assert.deepEqual(second.args, toInertValue({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(second.then.args, toInertValue({
    serialNumber: "ABC123",
  }))
})

test("prepareViewerContractCall rejects non-cloneable contract ABIs", async () => {
  const contracts = resolvedContracts()
  const abi = contracts["contracts.App"]?.abi as Abi
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  ;(abi[0] as Record<string, unknown>).outputs = [cyclic]

  await assert.rejects(
    () => prepareViewerContractCall({
      publicClient,
      cam: camDocument(),
      contracts,
      host,
      route: "writeRoute",
      inputs: {
        serialNumber: "ABC123",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_INVALID_INERT_VALUE"
      && error.message === "CAM viewer data is not safely cloneable: contract.abi"
      && error.cause instanceof InertValueError
      && error.cause.path === "0.outputs.0.self",
  )
})

test("prepareViewerContractCall resolves continuations with the route context", async () => {
  const call = await prepareViewerContractCall({
    publicClient,
    cam: camDocument(),
    contracts: resolvedContracts(),
    host,
    route: "writeRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.deepEqual(call.then.args, toInertValue({
    serialNumber: "ABC123",
  }))
})

function camDocument(): CamDocument {
  return parseCam({
    cam: CAM_VERSION, protocol: { uri: "./protocol.html", integrity: "sha256:0x" + "00".repeat(32) },
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
          args: {},
        },
      },
      writeRoute: {
        kind: "write",
        inputs: ["serialNumber"],
        call: {
          namespace: "contracts.App",
          function: "write",
          args: {
            serialNumber: "$inputs.serialNumber",
          },
        },
        then: {
          namespace: "routes",
          function: "readRoute",
          args: {
            serialNumber: "$inputs.serialNumber",
          },
        },
      },
      accountWrite: {
        kind: "write",
        inputs: ["serialNumber"],
        call: {
          namespace: "contracts.App",
          function: "writeForOwner",
          args: {
            owner: "$account.address",
            serialNumber: "$inputs.serialNumber",
          },
        },
        then: {
          namespace: "routes",
          function: "readRoute",
          args: {
            owner: "$account.address",
          },
        },
      },
    },
  })
}

function camWithWriteCallNamespace(namespace: string): CamDocument {
  const cam = camDocument()
  const writeRoute = cam.routes.writeRoute
  return {
    ...cam,
    routes: {
      ...cam.routes,
      writeRoute: {
        ...writeRoute,
        call: {
          ...writeRoute.call,
          namespace,
        },
      },
    },
  }
}

function resolvedContracts(): Record<string, ResolvedCamContract> {
  return {
    "contracts.App": {
      address: contractAddress,
      abi: writeAbi(),
    },
  }
}

function writeAbi(): Abi {
  return [
    {
      type: "function",
      name: "write",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "serialNumber",
          type: "string",
        },
      ],
      outputs: [],
    },
    {
      type: "function",
      name: "writeForOwner",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "owner",
          type: "address",
        },
        {
          name: "serialNumber",
          type: "string",
        },
      ],
      outputs: [],
    },
  ]
}
