import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCam,
} from "@cam/core"
import type {
  ResolvedCamContract,
} from "@cam/evm-viem"
import {
  toInertValue,
} from "@cam/protocol"
import type {
  Abi,
  Address,
} from "viem"

import {
  prepareViewerContractCall,
} from "../src/write-preparation.ts"

const host = {
  chainId: "eip155:31337",
  address: "0x0000000000000000000000000000000000000001" as Address,
} as const
const contractAddress = "0x0000000000000000000000000000000000000002" as Address
const namespace = "contracts.App"
const payableAbi = [{
  type: "function",
  name: "fund",
  stateMutability: "payable",
  inputs: [{ name: "memo", type: "string" }],
  outputs: [],
}] as const satisfies Abi
const nonpayableAbi = [{
  type: "function",
  name: "save",
  stateMutability: "nonpayable",
  inputs: [],
  outputs: [],
}] as const satisfies Abi

test("prepared CAM 1.1 calls disclose the resolved transaction value as inert data", () => {
  const prepared = prepareViewerContractCall({
    cam: writeCam({
      version: "1.1.0",
      functionName: "fund",
      args: { memo: "escrow" },
      value: "$inputs.amount",
    }),
    contracts: contracts(payableAbi),
    host,
    route: "write",
    inputs: toInertValue({ amount: "1000000000000000000" }),
  })

  assert.deepEqual(prepared, toInertValue({
    route: "write",
    address: contractAddress,
    abi: payableAbi,
    function: "fund",
    args: { memo: "escrow" },
    value: "1000000000000000000",
    then: {
      namespace: "routes",
      function: "entry",
      args: {},
    },
  }))
})

test("prepared nonpayable calls retain the value-free call shape", () => {
  const prepared = prepareViewerContractCall({
    cam: writeCam({
      version: "1.0.0",
      functionName: "save",
      args: {},
    }),
    contracts: contracts(nonpayableAbi),
    host,
    route: "write",
    inputs: {},
  })

  assert.equal(Object.hasOwn(prepared, "value"), false)
})

function writeCam({
  version,
  functionName,
  args,
  value,
}: {
  readonly version: "1.0.0" | "1.1.0"
  readonly functionName: string
  readonly args: Record<string, unknown>
  readonly value?: unknown
}) {
  return parseCam({
    cam: version,
    entry: "entry",
    namespaces: {
      [namespace]: {
        type: "contract",
        abiURI: "./abi/App.json",
        integrity: "sha256:fixture",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: "sha256:fixture",
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
        call: {
          namespace,
          function: "viewEntry",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$outputs.0",
          },
        },
      },
      write: {
        kind: "write",
        inputs: value === undefined ? [] : ["amount"],
        ...(value === undefined ? {} : { value }),
        call: {
          namespace,
          function: functionName,
          args,
        },
        then: {
          namespace: "routes",
          function: "entry",
          args: {},
        },
      },
    },
  })
}

function contracts(abi: Abi): Record<string, ResolvedCamContract> {
  return {
    [namespace]: {
      address: contractAddress,
      abi,
    },
  }
}
