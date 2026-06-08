import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { CAM_RESOURCE_MAX_BYTES, toInertValue } from "@cam/protocol"
import { sha256, toFunctionSelector } from "viem"
import type { Abi, Address, Chain, Hex } from "viem"

import {
  CamEvmError,
  callCamRoute,
  evmChainIdHex,
  evmChainIdNumber,
  loadCamFromHost,
  requireEvmAddress,
  requireEvmChainId,
  resolveCamContracts,
  sendCamContractCall,
  simulateCamContractCall,
} from "../src/index.ts"
import { ICAM_APP_INTERFACE_ID } from "../src/abi.ts"
import type { CamHost, CamSimulationClient, CamWalletClient } from "../src/index.ts"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camDocumentURI,
  BIKE_MANAGER_ABI_URI as managerAbiURI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MANAGER_CONTRACT,
  BIKE_MANAGER_NAMESPACE,
  BIKE_MARK_MISSING,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_HASH,
  BIKE_SERIAL_NUMBER,
  BIKE_TOKEN_ID,
  BIKE_UNSIGNED_CAM_HASH,
  BIKE_UI_ABI_URI as uiAbiURI,
  BIKE_UI_ADDRESS as uiAddress,
  BIKE_UI_CONTRACT,
  BIKE_UI_NAMESPACE,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  bikeEntryRouteResult,
  bikeContractAddresses,
  bikeHost,
  bikeRouteResults,
} from "../../../../tests/fixtures/cam/bike.mts"
import {
  bikeCamJson as camJson,
  bikeManagerAbiBytes as managerAbiBytes,
  bikeManagerAbi as managerAbiJson,
  bikeUiAbiBytes as uiAbiBytes,
  bikeUiAbi as uiAbiJson,
} from "../../../../tests/fixtures/cam/bike-resources.mts"
import {
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const ROOT_CAM_URI = "camURI"
const ROOT_CAM_HASH = "camHash"
const NO_ROUTE_RESULTS = {}
const uiAbi = uiAbiJson as Abi
const managerAbi = managerAbiJson as Abi
const testChain: Chain = {
  id: 31337,
  name: "CAM test chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
  },
}

test("validates EVM address and chain boundary values", () => {
  assert.equal(requireEvmAddress(userAddress, "account"), userAddress)
  assert.equal(requireEvmChainId("eip155:31337"), "eip155:31337")
  assert.equal(evmChainIdNumber("eip155:31337"), 31337)
  assert.equal(evmChainIdHex("eip155:31337"), "0x7a69")
  assert.throws(() => requireEvmAddress("0xabc", "account"), /address/)
  assert.throws(() => requireEvmChainId("31337"), /CAIP-2/)
})

test("uses the Solidity ICamApp interface id", () => {
  assert.equal(ICAM_APP_INTERFACE_ID, xorSelectors(["camURI()", "camHash()"]))
})

test("loadCamFromHost reads root metadata, parses namespaced CAMs, and rejects hash mismatches", async () => {
  const camBytes = encodeJson(camJson)
  const publicClient = createPublicClient(publicClientFixtureOptions({
    camURI: camDocumentURI,
    camHash: BIKE_UNSIGNED_CAM_HASH,
  }))
  const resources = createResourceLoader({
    [camDocumentURI]: camBytes,
  })

  const loaded = await loadCamFromHost({
    publicClient,
    host,
    loadResource: resources,
    allowUnsignedCamHash: true,
  })

  assert.equal(loaded.camURI, camDocumentURI)
  assert.deepEqual(loaded.cam, parseCam(camJson))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    "supportsInterface",
    ROOT_CAM_URI,
    ROOT_CAM_HASH,
  ])
  assert.deepEqual(publicClient.calls[0]?.args, [ICAM_APP_INTERFACE_ID])
  assert.equal(publicClient.chainCalls, 1)

  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        camURI: camDocumentURI,
        camHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      })),
      host,
      loadResource: resources,
      allowUnsignedCamHash: false,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_MISMATCH",
  )

  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        chainId: 1,
      })),
      host,
      loadResource: resources,
      allowUnsignedCamHash: true,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_CHAIN_MISMATCH",
  )

  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        supportsCamInterface: false,
      })),
      host,
      loadResource: resources,
      allowUnsignedCamHash: true,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HOST_UNSUPPORTED",
  )

  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      host,
      loadResource: createResourceLoader({
        [camDocumentURI]: new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1),
      }),
      allowUnsignedCamHash: true,
    }),
    (error) => error instanceof CamEvmError
      && error.code === "CAM_RESOURCE_LOAD_FAILED"
      && error.cause instanceof Error
      && /too large/.test(error.cause.message),
  )
})

test("resolveCamContracts resolves namespaced contracts through CamRoot", async () => {
  const cam = parseCam(camJson)
  const publicClient = createPublicClient(publicClientFixtureOptions({
    addresses: {
      [BIKE_UI_CONTRACT]: uiAddress,
      [BIKE_MANAGER_CONTRACT]: managerAddress,
    },
  }))
  const resources = createResourceLoader({
    [uiAbiURI]: uiAbiBytes,
    [managerAbiURI]: managerAbiBytes,
  })

  const contracts = await resolveCamContracts({
    publicClient,
    host,
    camURI: camDocumentURI,
    cam,
    loadResource: resources,
  })

  assert.equal(contracts[BIKE_UI_NAMESPACE].address, uiAddress)
  assert.equal(contracts[BIKE_MANAGER_NAMESPACE].address, managerAddress)
  assert.deepEqual(contracts[BIKE_UI_NAMESPACE].abi, uiAbi)
  assert.equal(Object.getPrototypeOf(contracts), null)
})

test("resolveCamContracts rejects invalid bindings and malformed ABIs", async () => {
  const invalidAbiItemBytes = encodeJson([{ name: BIKE_VIEW_ENTRY }])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: "not-an-address" as Address,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: parseCam(camJson),
      loadResource: createResourceLoader({
        [uiAbiURI]: uiAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_CONTRACT_INVALID",
  )

  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, invalidAbiItemBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: invalidAbiItemBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const invalidAbiParameterBytes = encodeJson([{
    type: "function",
    name: BIKE_VIEW_ENTRY,
    stateMutability: "view",
    inputs: [{ name: "account" }],
    outputs: [],
  }])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, invalidAbiParameterBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: invalidAbiParameterBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const invalidFunctionNameAbiBytes = encodeJson([{
    type: "function",
    name: `${BIKE_VIEW_ENTRY}-bad`,
    stateMutability: "view",
    inputs: [],
    outputs: [],
  }])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, invalidFunctionNameAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: invalidFunctionNameAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const fixedArrayAbiBytes = encodeJson([{
    type: "function",
    name: BIKE_VIEW_ENTRY,
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "ids", type: "uint256[2]" }],
  }])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, fixedArrayAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: fixedArrayAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  for (const type of ["uint257[]", "bytes33[]", "uint256[2][]", "tuple123"]) {
    const invalidAbiTypeBytes = encodeJson([{
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "values", type, components: [{ name: "value", type: "string" }] }],
    }])
    await assert.rejects(
      () => resolveCamContracts({
        publicClient: createPublicClient(publicClientFixtureOptions({
          addresses: {
            [BIKE_UI_CONTRACT]: uiAddress,
            [BIKE_MANAGER_CONTRACT]: managerAddress,
          },
        })),
        host,
        camURI: camDocumentURI,
        cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, invalidAbiTypeBytes),
        loadResource: createResourceLoader({
          [uiAbiURI]: invalidAbiTypeBytes,
          [managerAbiURI]: managerAbiBytes,
        }),
      }),
      (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
    )
  }

  const duplicateSignatureAbiBytes = encodeJson([
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [],
    },
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [{ name: "otherAccount", type: "address" }],
      outputs: [],
    },
  ])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, duplicateSignatureAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: duplicateSignatureAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const duplicateInputNameAbiBytes = encodeJson([
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [
        { name: "amount", type: "uint256" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [],
    },
  ])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, duplicateInputNameAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: duplicateInputNameAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const duplicateTupleComponentAbiBytes = encodeJson([
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          name: "view",
          type: "tuple",
          components: [
            { name: "amount", type: "uint256" },
            { name: "amount", type: "uint256" },
          ],
        },
      ],
    },
  ])
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, duplicateTupleComponentAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: duplicateTupleComponentAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
  )

  const oversizedAbiBytes = new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)
  await assert.rejects(
    () => resolveCamContracts({
      publicClient: createPublicClient(publicClientFixtureOptions({
        addresses: {
          [BIKE_UI_CONTRACT]: uiAddress,
          [BIKE_MANAGER_CONTRACT]: managerAddress,
        },
      })),
      host,
      camURI: camDocumentURI,
      cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, oversizedAbiBytes),
      loadResource: createResourceLoader({
        [uiAbiURI]: oversizedAbiBytes,
        [managerAbiURI]: managerAbiBytes,
      }),
    }),
    (error) => error instanceof CamEvmError
      && error.code === "CAM_RESOURCE_LOAD_FAILED"
      && error.cause instanceof Error
      && /too large/.test(error.cause.message),
  )
})

test("callCamRoute orders named args by ABI and returns normalized route values", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress),
  }))

  const result = await callCamRoute({
    publicClient,
    cam: parseCam(camJson),
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi: uiAbi,
      },
    },
    route: BIKE_ROUTE_COMPONENT,
    context: {
      host,
      account: { address: userAddress },
      inputs: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
      outputs: [],
    },
  })

  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])
  assert.deepEqual(result.values[0], toInertValue({
    viewId: "component.found",
    actions: ["lookupComponent", "updateComponentMetadata", "markComponentMissing", "retireComponent"],
    account: userAddress,
    canRegister: true,
    accountInfo: "Mock registrar account",
    exists: true,
    serialHash: BIKE_SERIAL_HASH,
    tokenContract: "0x0000000000000000000000000000000000000010",
    tokenId: BIKE_TOKEN_ID.toString(),
    owner: userAddress,
    ownerInfo: "Mock owner account",
    registrar: userAddress,
    status: "1",
    tokenURI: `ipfs://example/token/${BIKE_SERIAL_NUMBER}`,
    registeredAt: "1",
    updatedAt: "2",
    serialNumber: BIKE_SERIAL_NUMBER,
    permissions: "15",
    isOwner: true,
    canUpdateMetadata: true,
    canMarkMissing: true,
    canClearMissing: false,
    canRetire: true,
    componentsAddress: "0x0000000000000000000000000000000000000000",
  }))
})

test("callCamRoute resolves full signatures for overloaded route functions", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: {
      [BIKE_VIEW_ENTRY]: bikeEntryRouteResult(userAddress),
    },
  }))
  const cam = camWithRouteCallFunction(BIKE_ROUTE_ENTRY, `${BIKE_VIEW_ENTRY}(address)`)
  const abi = overloadedViewEntryAbi()

  await callCamRoute({
    publicClient,
    cam,
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi,
      },
    },
    route: BIKE_ROUTE_ENTRY,
    context: {
      host,
      account: { address: userAddress },
      inputs: {},
      outputs: [],
    },
  })

  const call = publicClient.calls.at(-1)
  assert.equal(call?.functionName, BIKE_VIEW_ENTRY)
  assert.deepEqual(call?.abi, [findAbiFunction(abi, BIKE_VIEW_ENTRY)])
})

test("callCamRoute normalizes safe number integer outputs from real RPC clients", async () => {
  const result = await callCamRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({
      routeResults: {
        [BIKE_VIEW_ENTRY]: {
          ...bikeEntryRouteResult(userAddress),
          status: 0,
        },
      },
    })),
    cam: parseCam(camJson),
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi: uiAbi,
      },
    },
    route: BIKE_ROUTE_ENTRY,
    context: {
      host,
      account: { address: userAddress },
      inputs: {},
      outputs: [],
    },
  })

  assert.equal((result.values[0] as Record<string, unknown>).status, "0")
})

test("callCamRoute rejects non-canonical integer output shapes", async () => {
  const integerRoute = "integerRoute"
  const integerFunction = "viewInteger"
  const cam = parseCam({
    ...camJson,
    routes: {
      ...camJson.routes,
      [integerRoute]: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: integerFunction,
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
    },
  })
  const abi = [
    {
      type: "function",
      name: integerFunction,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "value", type: "uint256" }],
    },
  ] as const satisfies Abi

  for (const value of [Number.MAX_SAFE_INTEGER + 1, "1"]) {
    await assert.rejects(
      () => callCamRoute({
        publicClient: createPublicClient(publicClientFixtureOptions({
          routeResults: {
            [integerFunction]: value,
          },
        })),
        cam,
        contracts: {
          [BIKE_UI_NAMESPACE]: {
            address: uiAddress,
            abi,
          },
        },
        route: integerRoute,
        context: {
          host,
          account: { address: userAddress },
          inputs: {},
          outputs: [],
        },
      }),
      (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
    )
  }
})

test("callCamRoute normalizes array-like decoded tuple outputs by ABI component name", async () => {
  const tupleRoute = "tupleRoute"
  const tupleFunction = "viewTuple"
  const cam = parseCam({
    ...camJson,
    routes: {
      ...camJson.routes,
      [tupleRoute]: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: tupleFunction,
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
    },
  })
  const abi = [
    {
      type: "function",
      name: tupleFunction,
      stateMutability: "view",
      inputs: [],
      outputs: [{
        name: "view_",
        type: "tuple",
        components: [
          { name: "status", type: "uint8" },
          { name: "owner", type: "address" },
        ],
      }],
    },
  ] as const satisfies Abi

  const result = await callCamRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({
      routeResults: {
        [tupleFunction]: [1, userAddress],
      },
    })),
    cam,
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi,
      },
    },
    route: tupleRoute,
    context: {
      host,
      account: { address: userAddress },
      inputs: {},
      outputs: [],
    },
  })

  assert.deepEqual(result.values[0], toInertValue({
    status: "1",
    owner: userAddress,
  }))

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({
        routeResults: {
          [tupleFunction]: {
            status: 1,
            owner: userAddress,
            extra: "rejected",
          },
        },
      })),
      cam,
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi,
        },
      },
      route: tupleRoute,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
  )
})

test("callCamRoute treats a single array output as one ABI output", async () => {
  const arrayRoute = "arrayRoute"
  const arrayFunction = "viewArray"
  const cam = parseCam({
    ...camJson,
    routes: {
      ...camJson.routes,
      [arrayRoute]: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: arrayFunction,
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
    },
  })
  const abi = [
    {
      type: "function",
      name: arrayFunction,
      stateMutability: "view",
      inputs: [],
      outputs: [{ name: "items", type: "string[]" }],
    },
  ] as const satisfies Abi
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: {
      [arrayFunction]: ["one", "two"],
    },
  }))

  const result = await callCamRoute({
    publicClient,
    cam,
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi,
      },
    },
    route: arrayRoute,
    context: {
      host,
      account: { address: userAddress },
      inputs: {},
      outputs: [],
    },
  })

  assert.deepEqual(result.values, toInertValue([["one", "two"]]))
})

test("callCamRoute rejects mutable route functions and invalid named args", async () => {
  const nonViewAbi = [
    {
      ...findAbiFunction(uiAbi, BIKE_VIEW_ENTRY),
      stateMutability: "nonpayable",
    },
  ] as const satisfies Abi

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam(camJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: nonViewAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_NOT_VIEW",
  )

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam(camJson),
      contracts: {},
      route: "markComponentMissing",
      context: {
        host,
        account: { address: userAddress },
        inputs: {
          serialNumber: BIKE_SERIAL_NUMBER,
        },
        outputs: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_KIND",
  )

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam({
        ...camJson,
        routes: {
          ...camJson.routes,
          entry: {
            ...camJson.routes.entry,
            call: {
              ...camJson.routes.entry.call,
              args: {
                extra: "x",
              },
            },
          },
        },
      }),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: uiAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_ARGUMENT",
  )

  const invalidAddressAbi = [
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "owner", type: "address" }],
    },
  ] as const satisfies Abi
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({
        routeResults: {
          [BIKE_VIEW_ENTRY]: "not-an-address",
        },
      })),
      cam: parseCam(camJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: invalidAddressAbi,
        },
      },
      route: BIKE_ROUTE_ENTRY,
      context: {
        host,
        account: { address: userAddress },
        inputs: {},
        outputs: [],
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
  )
})

test("sendCamContractCall and simulateCamContractCall validate named write args", async () => {
  const walletClient = createWalletClient()

  const hash = await sendCamContractCall({
    walletClient,
    chain: testChain,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.equal(hash, "0x1234")
  const markMissingAbi = [findAbiFunction(managerAbi, BIKE_MARK_MISSING)]
  assert.deepEqual(walletClient.calls, [
    {
      address: managerAddress,
      abi: markMissingAbi,
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
      chain: testChain,
    },
  ])

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: managerAbi,
        function: BIKE_MARK_MISSING,
        args: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )

  const publicClient = createSimulationClient()
  await simulateCamContractCall({
    publicClient,
    account: userAddress,
    call: {
      address: managerAddress,
      abi: managerAbi,
      function: BIKE_MARK_MISSING,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.deepEqual(publicClient.calls, [
    {
      address: managerAddress,
      abi: markMissingAbi,
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
      account: userAddress,
    },
  ])
})

test("sendCamContractCall keeps tuple input component names as inert data", async () => {
  const walletClient = createWalletClient()
  const tupleAbi = [
    {
      type: "function",
      name: "writeTuple",
      stateMutability: "nonpayable",
      inputs: [{
        name: "payload",
        type: "tuple",
        components: [
          { name: "__proto__", type: "string" },
          { name: "value", type: "string" },
        ],
      }],
      outputs: [],
    },
  ] as const satisfies Abi

  await sendCamContractCall({
    walletClient,
    chain: testChain,
    call: {
      address: managerAddress,
      abi: tupleAbi,
      function: "writeTuple",
      args: {
        payload: toInertValue({
          ["__proto__"]: "component-name",
          value: "ordinary-value",
        }),
      },
    },
  })

  const tupleArg = walletClient.calls[0]?.args?.[0]
  assert.equal(typeof tupleArg, "object")
  assert.notEqual(tupleArg, null)
  assert.equal(Object.getPrototypeOf(tupleArg), null)
  assert.equal(Object.hasOwn(tupleArg as Record<string, unknown>, "__proto__"), true)
  assert.equal((tupleArg as Record<string, unknown>)["__proto__"], "component-name")
  assert.equal((tupleArg as Record<string, unknown>).value, "ordinary-value")

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: tupleAbi,
        function: "writeTuple",
        args: {
          payload: toInertValue({
            ["__proto__"]: "component-name",
            value: "ordinary-value",
            extra: "rejected",
          }),
        },
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )
})

test("sendCamContractCall resolves full signatures for overloaded writes", async () => {
  const walletClient = createWalletClient()
  const abi = overloadedMarkMissingAbi()
  await sendCamContractCall({
    walletClient,
    chain: testChain,
    call: {
      address: managerAddress,
      abi,
      function: `${BIKE_MARK_MISSING}(string)`,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
      },
    },
  })

  assert.deepEqual(walletClient.calls, [
    {
      address: managerAddress,
      abi: [findAbiFunction(abi, BIKE_MARK_MISSING)],
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER],
      chain: testChain,
    },
  ])
})

test("sendCamContractCall rejects odd-length dynamic bytes", async () => {
  const walletClient = createWalletClient()
  const bytesAbi = [
    {
      type: "function",
      name: "writeBytes",
      stateMutability: "nonpayable",
      inputs: [{ name: "payload", type: "bytes" }],
      outputs: [],
    },
  ] as const satisfies Abi

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: bytesAbi,
        function: "writeBytes",
        args: {
          payload: "0xabc",
        },
      },
    }),
    /expected whole-byte hex value/,
  )
})

test("sendCamContractCall rejects payable writes until CAM has a value model", async () => {
  const walletClient = createWalletClient()
  const payableAbi = [
    {
      type: "function",
      name: "pay",
      stateMutability: "payable",
      inputs: [],
      outputs: [],
    },
  ] as const satisfies Abi

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: payableAbi,
        function: "pay",
        args: {},
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_FUNCTION_PAYABLE_UNSUPPORTED",
  )
})

function createPublicClient({
  chainId,
  camURI,
  camHash,
  supportsCamInterface,
  addresses,
  routeResults,
}: PublicClientFixtureOptions) {
  // This fake models raw viem return values before callCamRoute normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient({
    chainId,
    camURI,
    camHash,
    supportsCamInterface,
    addresses,
    routeResults,
  })
}

type PublicClientFixtureOptions = {
  readonly chainId: number
  readonly camURI: string
  readonly camHash: Hex
  readonly supportsCamInterface: boolean
  readonly addresses: Record<string, Address>
  readonly routeResults: Record<string, unknown>
}

function publicClientFixtureOptions(overrides: Partial<PublicClientFixtureOptions>): PublicClientFixtureOptions {
  return {
    chainId: 31337,
    camURI: camDocumentURI,
    camHash: BIKE_UNSIGNED_CAM_HASH,
    supportsCamInterface: true,
    addresses: bikeContractAddresses,
    routeResults: NO_ROUTE_RESULTS,
    ...overrides,
  }
}

function camWithNamespaceIntegrity(namespace: string, bytes: Uint8Array) {
  const namespaces = camJson.namespaces as Record<string, unknown>
  const declaration = namespaces[namespace]
  assert.equal(typeof declaration, "object")
  assert.notEqual(declaration, null)
  assert.equal(Array.isArray(declaration), false)

  return parseCam({
    ...camJson,
    namespaces: {
      ...namespaces,
      [namespace]: {
        ...(declaration as Record<string, unknown>),
        integrity: resourceIntegrity(bytes),
      },
    },
  })
}

function camWithRouteCallFunction(routeName: string, functionName: string) {
  const routes = camJson.routes as Record<string, unknown>
  const route = routes[routeName] as Record<string, unknown>
  const call = route.call as Record<string, unknown>

  return parseCam({
    ...camJson,
    routes: {
      ...routes,
      [routeName]: {
        ...route,
        call: {
          ...call,
          function: functionName,
        },
      },
    },
  })
}

function resourceIntegrity(bytes: Uint8Array): string {
  return `sha256:${sha256(bytes)}`
}

function xorSelectors(signatures: readonly string[]): `0x${string}` {
  const selector = signatures.reduce((result, signature) => {
    return result ^ Number.parseInt(toFunctionSelector(signature).slice(2), 16)
  }, 0)

  return `0x${(selector >>> 0).toString(16).padStart(8, "0")}`
}

function createSimulationClient(failure?: Error): CamSimulationClient & {
  readonly calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account: Address
  }>
} {
  const calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly account: Address
  }> = []

  return {
    calls,
    async simulateContract(request) {
      calls.push(request)
      if (failure !== undefined) {
        throw failure
      }
    },
  }
}

function createWalletClient(): CamWalletClient & {
  readonly calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: Chain
  }>
} {
  const calls: Array<{
    readonly address: Address
    readonly abi: Abi
    readonly functionName: string
    readonly args?: readonly unknown[]
    readonly chain: Chain
  }> = []

  return {
    calls,
    async writeContract(request) {
      calls.push(request)
      return "0x1234"
    },
  }
}

function overloadedViewEntryAbi(): Abi {
  return [
    findAbiFunction(uiAbi, BIKE_VIEW_ENTRY),
    {
      ...findAbiFunction(uiAbi, BIKE_VIEW_ENTRY),
      inputs: [
        {
          name: "account",
          type: "address",
        },
        {
          name: "serialNumber",
          type: "string",
        },
      ],
    },
  ] as const satisfies Abi
}

function overloadedMarkMissingAbi(): Abi {
  return [
    findAbiFunction(managerAbi, BIKE_MARK_MISSING),
    {
      ...findAbiFunction(managerAbi, BIKE_MARK_MISSING),
      inputs: [
        {
          name: "serialNumber",
          type: "string",
        },
        {
          name: "account",
          type: "address",
        },
      ],
    },
  ] as const satisfies Abi
}

type AbiFunctionItem = Extract<Abi[number], { readonly type: "function" }>

function findAbiFunction(abi: Abi, functionName: string): AbiFunctionItem {
  const item = abi.find((candidate): candidate is AbiFunctionItem => (
    candidate.type === "function" && candidate.name === functionName
  ))
  if (item === undefined) {
    throw new Error(`missing ABI function fixture: ${functionName}`)
  }

  return item
}
