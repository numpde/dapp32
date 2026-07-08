import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { CAM_RESOURCE_MAX_BYTES, toInertValue } from "@cam/protocol"
import { sha256, toFunctionSelector } from "viem"
import type { Abi, AbiParameter, Address, Chain, Hex } from "viem"

import {
  ABI_DECLARATION_ACCEPTED_CASES,
  ABI_DECLARATION_REJECTED_CASES,
} from "../../../../tests/fixtures/cam/abi-declaration-cases.mts"
import type { AbiDeclarationCase } from "../../../../tests/fixtures/cam/abi-declaration-cases.mts"
import {
  CamEvmError,
  callCamRoute,
  createHttpCamPublicClient,
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
  BIKE_COMPONENTS_ADDRESS,
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
  BIKE_ZERO_ADDRESS,
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
const bikeMissingReportURI = "fixture://bike-nft/reports/js-missing.json"
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
  assert.throws(() => requireEvmChainId("eip155:9007199254740992"), /safe integer/)
  assert.throws(() => evmChainIdHex("eip155:9007199254740992"), /safe integer/)
})

test("validates EVM HTTP client transport URLs before creating clients", () => {
  assert.doesNotThrow(() => createHttpCamPublicClient({ rpcURL: "http://127.0.0.1:8545" }))
  assert.throws(() => createHttpCamPublicClient({ rpcURL: "file:///tmp/rpc" }), /http or https/)
  assert.throws(() => createHttpCamPublicClient({ rpcURL: "https://user@example.test/rpc" }), /credentials/)
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

  let unsignedRootLoads = 0
  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        camURI: camDocumentURI,
        camHash: BIKE_UNSIGNED_CAM_HASH,
      })),
      host,
      async loadResource() {
        unsignedRootLoads += 1
        return camBytes
      },
      allowUnsignedCamHash: false,
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_HASH_UNSIGNED",
  )
  assert.equal(unsignedRootLoads, 0)

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

  let unsafeRootLoads = 0
  await assert.rejects(
    () => loadCamFromHost({
      publicClient: createPublicClient(publicClientFixtureOptions({
        camURI: "file:///tmp/main.json",
      })),
      host,
      async loadResource() {
        unsafeRootLoads += 1
        return camBytes
      },
      allowUnsignedCamHash: true,
    }),
    (error) => error instanceof CamEvmError
      && error.code === "CAM_DOCUMENT_INVALID"
      && error.cause instanceof Error
      && /expected http:\/\/.*https:\/\/.*ipfs:\/\//.test(error.cause.message),
  )
  assert.equal(unsafeRootLoads, 0)

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

test("resolveCamContracts rejects invalid bindings and ABI resource load failures", async () => {
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

test("runtime ABI declaration parsing accepts the supported publication surface", async () => {
  assertUniqueAbiDeclarationLabels()

  for (const testCase of ABI_DECLARATION_ACCEPTED_CASES) {
    await assertRuntimeAbiAccepted(abiCaseBytes(testCase), testCase.label)
  }
})

test("runtime ABI declaration parsing rejects unsupported publication shapes", async () => {
  assertUniqueAbiDeclarationLabels()

  for (const testCase of ABI_DECLARATION_REJECTED_CASES) {
    await assertRuntimeAbiInvalid(abiCaseBytes(testCase), testCase.label)
  }
})

test("callCamRoute orders named args by ABI and returns normalized route values", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active"),
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
    tokenContract: BIKE_COMPONENTS_ADDRESS,
    tokenId: BIKE_TOKEN_ID.toString(),
    owner: userAddress,
    ownerInfo: "Mock owner account",
    registrar: userAddress,
    statusId: "active",
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
    componentsAddress: BIKE_ZERO_ADDRESS,
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

test("callCamRoute reports CAM errors for malformed direct ABI signature lookup", async () => {
  const cam = camWithRouteCallFunction(BIKE_ROUTE_ENTRY, `${BIKE_VIEW_ENTRY}(address)`)
  const malformedAbi = [
    null,
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
    },
  ] as unknown as Abi

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam,
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: malformedAbi,
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
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_FUNCTION_NOT_FOUND",
  )
})

test("callCamRoute normalizes safe number integer outputs from real RPC clients", async () => {
  const route = "integerRoute"
  const functionName = "viewInteger"
  const abi = readAbi(functionName, [{ name: "value", type: "uint256" }])

  const result = await callSyntheticReadRoute({
    route,
    functionName,
    abi,
    routeResult: 0,
  })

  assert.equal(result.values[0], "0")
})

test("callCamRoute rejects non-canonical integer output shapes", async () => {
  const route = "integerRoute"
  const functionName = "viewInteger"
  const abi = readAbi(functionName, [{ name: "value", type: "uint256" }])

  for (const value of [Number.MAX_SAFE_INTEGER + 1, "1"]) {
    await assertInvalidSyntheticRouteResult({
      route,
      functionName,
      abi,
      routeResult: value,
    }, `integer output rejects ${String(value)}`)
  }
})

test("callCamRoute rejects invalid bytes output shapes", async () => {
  const bytesRoute = "bytesRoute"
  const bytesFunction = "viewBytes"
  const abi = readAbi(bytesFunction, [{ name: "value", type: "bytes" }])

  await assertInvalidSyntheticRouteResult({
    route: bytesRoute,
    functionName: bytesFunction,
    abi,
    routeResult: "0xabc",
  })
})

test("callCamRoute normalizes array-like decoded tuple outputs by ABI component name", async () => {
  const tupleRoute = "tupleRoute"
  const tupleFunction = "viewTuple"
  const abi = readAbi(tupleFunction, [{
    name: "view_",
    type: "tuple",
    components: [
      { name: "status", type: "uint8" },
      { name: "owner", type: "address" },
    ],
  }])

  const result = await callSyntheticReadRoute({
    route: tupleRoute,
    functionName: tupleFunction,
    abi,
    routeResult: [1, userAddress],
  })

  assert.deepEqual(result.values[0], toInertValue({
    status: "1",
    owner: userAddress,
  }))

  await assertInvalidSyntheticRouteResult({
    route: tupleRoute,
    functionName: tupleFunction,
    abi,
    routeResult: {
      status: 1,
      owner: userAddress,
      extra: "rejected",
    },
  }, "tuple record extra field")

  await assertInvalidSyntheticRouteResult({
    route: tupleRoute,
    functionName: tupleFunction,
    abi,
    routeResult: [1, userAddress, "rejected"],
  }, "tuple array too many elements")

  const duplicateComponentAbi = readAbi(tupleFunction, [{
    name: "view_",
    type: "tuple",
    components: [
      { name: "status", type: "uint8" },
      { name: "status", type: "uint8" },
    ],
  }])
  await assertInvalidSyntheticRouteResult({
    route: tupleRoute,
    functionName: tupleFunction,
    abi: duplicateComponentAbi,
    routeResult: [1, 2],
  }, "tuple duplicate component names")
})

test("callCamRoute normalizes nested dynamic arrays of tuple outputs", async () => {
  const tupleRoute = "nestedTupleRoute"
  const tupleFunction = "viewNestedTuples"
  const abi = readAbi(tupleFunction, [{
    name: "groups",
    type: "tuple[][]",
    components: [
      { name: "serialNumber", type: "string" },
      { name: "count", type: "uint8" },
      { name: "owner", type: "address" },
    ],
  }])

  const recordResult = await callSyntheticReadRoute({
    route: tupleRoute,
    functionName: tupleFunction,
    abi,
    routeResult: [
      [
        {
          serialNumber: "ABC123",
          count: 7n,
          owner: userAddress,
        },
      ],
    ],
  })
  assert.deepEqual(recordResult.values[0], toInertValue([
    [
      {
        serialNumber: "ABC123",
        count: "7",
        owner: userAddress,
      },
    ],
  ]))

  const arrayResult = await callSyntheticReadRoute({
    route: tupleRoute,
    functionName: tupleFunction,
    abi,
    routeResult: [
      [
        ["ABC123", 7n, userAddress],
      ],
    ],
  })
  assert.deepEqual(arrayResult.values[0], toInertValue([
    [
      {
        serialNumber: "ABC123",
        count: "7",
        owner: userAddress,
      },
    ],
  ]))

  const invalidCases = [
    {
      label: "nested tuple record extra field",
      routeResult: [
        [
          {
            serialNumber: "ABC123",
            count: 7n,
            owner: userAddress,
            extra: "rejected",
          },
        ],
      ],
    },
    {
      label: "nested tuple array too many elements",
      routeResult: [
        [
          ["ABC123", 7n, userAddress, "rejected"],
        ],
      ],
    },
    {
      label: "nested tuple array too few elements",
      routeResult: [
        [
          ["ABC123", 7n],
        ],
      ],
    },
    {
      label: "nested tuple uint8 range failure",
      routeResult: [
        [
          ["ABC123", 300n, userAddress],
        ],
      ],
    },
    {
      label: "nested tuple uint8 type failure",
      routeResult: [
        [
          ["ABC123", "7", userAddress],
        ],
      ],
    },
  ] as const

  for (const { label, routeResult } of invalidCases) {
    await assertInvalidSyntheticRouteResult({
      route: tupleRoute,
      functionName: tupleFunction,
      abi,
      routeResult,
    }, label)
  }

  const duplicateComponentAbi = readAbi(tupleFunction, [{
    name: "groups",
    type: "tuple[][]",
    components: [
      { name: "serialNumber", type: "string" },
      { name: "serialNumber", type: "string" },
    ],
  }])

  await assertInvalidSyntheticRouteResult({
    route: tupleRoute,
    functionName: tupleFunction,
    abi: duplicateComponentAbi,
    routeResult: [
      [
        ["ABC123", "duplicate"],
      ],
    ],
  }, "nested tuple duplicate component names")
})

test("callCamRoute treats a single array output as one ABI output", async () => {
  const arrayRoute = "arrayRoute"
  const arrayFunction = "viewArray"
  const abi = readAbi(arrayFunction, [{ name: "items", type: "string[]" }])

  const result = await callSyntheticReadRoute({
    route: arrayRoute,
    functionName: arrayFunction,
    abi,
    routeResult: ["one", "two"],
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

  const duplicateInputAbi = [
    {
      type: "function",
      name: BIKE_VIEW_ENTRY,
      stateMutability: "view",
      inputs: [
        { name: "account", type: "address" },
        { name: "account", type: "address" },
      ],
      outputs: [],
    },
  ] as const satisfies Abi
  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam(camJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: uiAddress,
          abi: duplicateInputAbi,
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

  await assert.rejects(
    () => callCamRoute({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      cam: parseCam(camJson),
      contracts: {
        [BIKE_UI_NAMESPACE]: {
          address: "not-an-address" as Address,
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
    /contract\.address/,
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
        reportURI: bikeMissingReportURI,
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
      args: [BIKE_SERIAL_NUMBER, bikeMissingReportURI],
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

  const duplicateInputAbi = [
    {
      type: "function",
      name: "writeDuplicate",
      stateMutability: "nonpayable",
      inputs: [
        { name: "value", type: "string" },
        { name: "value", type: "string" },
      ],
      outputs: [],
    },
  ] as const satisfies Abi
  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: duplicateInputAbi,
        function: "writeDuplicate",
        args: {
          value: "ambiguous",
        },
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: "not-an-address" as Address,
        abi: managerAbi,
        function: BIKE_MARK_MISSING,
        args: {
          serialNumber: BIKE_SERIAL_NUMBER,
          reportURI: bikeMissingReportURI,
        },
      },
    }),
    /contract\.address/,
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
        reportURI: bikeMissingReportURI,
      },
    },
  })

  assert.deepEqual(publicClient.calls, [
    {
      address: managerAddress,
      abi: markMissingAbi,
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER, bikeMissingReportURI],
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

  const duplicateTupleAbi = [
    {
      type: "function",
      name: "writeTuple",
      stateMutability: "nonpayable",
      inputs: [{
        name: "payload",
        type: "tuple",
        components: [
          { name: "value", type: "string" },
          { name: "value", type: "string" },
        ],
      }],
      outputs: [],
    },
  ] as const satisfies Abi
  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: duplicateTupleAbi,
        function: "writeTuple",
        args: {
          payload: toInertValue({
            value: "ambiguous",
          }),
        },
      },
    }),
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
  )
})

test("sendCamContractCall normalizes nested dynamic arrays of tuple inputs", async () => {
  const walletClient = createWalletClient()
  const nestedAbi = [
    {
      type: "function",
      name: "writeNested",
      stateMutability: "nonpayable",
      inputs: [{
        name: "groups",
        type: "tuple[][]",
        components: [
          { name: "serialNumber", type: "string" },
          { name: "count", type: "uint8" },
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
      abi: nestedAbi,
      function: "writeNested",
      args: {
        groups: toInertValue([
          [
            {
              serialNumber: "ABC123",
              count: "7",
            },
          ],
        ]),
      },
    },
  })

  const groups = walletClient.calls[0]?.args?.[0] as readonly (readonly unknown[])[] | undefined
  const nestedTuple = groups?.[0]?.[0]
  assert.equal(typeof nestedTuple, "object")
  assert.notEqual(nestedTuple, null)
  assert.equal(Object.getPrototypeOf(nestedTuple), null)
  assert.deepEqual({ ...(nestedTuple as Record<string, unknown>) }, {
    serialNumber: "ABC123",
    count: 7n,
  })

  await assert.rejects(
    () => sendCamContractCall({
      walletClient,
      chain: testChain,
      call: {
        address: managerAddress,
        abi: nestedAbi,
        function: "writeNested",
        args: {
          groups: toInertValue([
            [
              {
                serialNumber: "ABC123",
                count: "300",
              },
            ],
          ]),
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
      function: `${BIKE_MARK_MISSING}(string,string)`,
      args: {
        serialNumber: BIKE_SERIAL_NUMBER,
        reportURI: bikeMissingReportURI,
      },
    },
  })

  assert.deepEqual(walletClient.calls, [
    {
      address: managerAddress,
      abi: [findAbiFunction(abi, BIKE_MARK_MISSING)],
      functionName: BIKE_MARK_MISSING,
      args: [BIKE_SERIAL_NUMBER, bikeMissingReportURI],
      chain: testChain,
    },
  ])
})

test("sendCamContractCall rejects invalid dynamic bytes", async () => {
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
    (error) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT",
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

async function assertRuntimeAbiAccepted(abiBytes: Uint8Array, label: string): Promise<void> {
  await resolveContractsWithUiAbi(abiBytes).catch((error: unknown) => {
    assert.fail(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  })
}

async function assertRuntimeAbiInvalid(abiBytes: Uint8Array, label: string): Promise<void> {
  await assert.rejects(
    () => resolveContractsWithUiAbi(abiBytes),
    (error) => error instanceof CamEvmError && error.code === "CAM_ABI_INVALID",
    label,
  )
}

function abiCaseBytes(testCase: AbiDeclarationCase): Uint8Array {
  if ("rawText" in testCase) return new TextEncoder().encode(testCase.rawText)
  return encodeJson(testCase.value)
}

function assertUniqueAbiDeclarationLabels(): void {
  const labels = [
    ...ABI_DECLARATION_ACCEPTED_CASES,
    ...ABI_DECLARATION_REJECTED_CASES,
  ].map(({ label }) => label)
  assert.equal(new Set(labels).size, labels.length)
}

async function resolveContractsWithUiAbi(abiBytes: Uint8Array) {
  return resolveCamContracts({
    publicClient: createPublicClient(publicClientFixtureOptions({
      addresses: {
        [BIKE_UI_CONTRACT]: uiAddress,
        [BIKE_MANAGER_CONTRACT]: managerAddress,
      },
    })),
    host,
    camURI: camDocumentURI,
    cam: camWithNamespaceIntegrity(BIKE_UI_NAMESPACE, abiBytes),
    loadResource: createResourceLoader({
      [uiAbiURI]: abiBytes,
      [managerAbiURI]: managerAbiBytes,
    }),
  })
}

function camWithSyntheticReadRoute({
  route,
  functionName,
}: {
  readonly route: string
  readonly functionName: string
}) {
  return parseCam({
    ...camJson,
    routes: {
      ...camJson.routes,
      [route]: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: functionName,
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
}

function readAbi(functionName: string, outputs: readonly AbiParameter[]): Abi {
  return [{
    type: "function",
    name: functionName,
    stateMutability: "view",
    inputs: [],
    outputs,
  }]
}

async function callSyntheticReadRoute({
  route,
  functionName,
  abi,
  routeResult,
}: {
  readonly route: string
  readonly functionName: string
  readonly abi: Abi
  readonly routeResult: unknown
}) {
  return callCamRoute({
    publicClient: createPublicClient(publicClientFixtureOptions({
      routeResults: {
        [functionName]: routeResult,
      },
    })),
    cam: camWithSyntheticReadRoute({ route, functionName }),
    contracts: {
      [BIKE_UI_NAMESPACE]: {
        address: uiAddress,
        abi,
      },
    },
    route,
    context: {
      host,
      account: { address: userAddress },
      inputs: {},
      outputs: [],
    },
  })
}

async function assertInvalidSyntheticRouteResult(
  args: Parameters<typeof callSyntheticReadRoute>[0],
  label?: string,
) {
  await assert.rejects(
    () => callSyntheticReadRoute(args),
    (error) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_RESULT",
    label,
  )
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
          name: "reportURI",
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
