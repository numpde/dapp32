import assert from "node:assert/strict"
import test from "node:test"

import { CamError, parseCam } from "@cam/core"
import { CAM_VERSION, toInertValue } from "@cam/protocol"
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
const contractAddress = "0x00000000000000000000000000000000000000A0" as Address

test("prepareViewerContractCall prepares a write route call", () => {
  const contracts = resolvedContracts()
  const call = prepareViewerContractCall({
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
  assert.deepEqual(call.then, {
    namespace: "routes",
    function: "readRoute",
    args: toInertValue({
      serialNumber: "ABC123",
    }),
  })
  assert.deepEqual(call.abi, toInertValue(contracts["contracts.App"]?.abi))
})

test("prepareViewerContractCall rejects missing routes", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall rejects read routes", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall rejects account-required write routes without an account", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall accepts account-required write routes with an account", () => {
  const call = prepareViewerContractCall({
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

test("prepareViewerContractCall propagates route call resolver failures", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall rejects non-contract call namespaces", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall rejects unresolved contract namespaces", () => {
  assert.throws(
    () => prepareViewerContractCall({
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

test("prepareViewerContractCall clones the prepared ABI", () => {
  const contracts = resolvedContracts()
  const call = prepareViewerContractCall({
    cam: camDocument(),
    contracts,
    host,
    route: "writeRoute",
    inputs: {
      serialNumber: "ABC123",
    },
  })

  assert.notEqual(call.abi, contracts["contracts.App"]?.abi)
  assert.deepEqual(call.abi, toInertValue(contracts["contracts.App"]?.abi))
})

test("prepareViewerContractCall resolves continuations with the route context", () => {
  const call = prepareViewerContractCall({
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
