import {
  camVersionSupportsWriteValue,
} from "@cam/protocol"

import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import {
  resolvedAbiFunction,
  type AbiFunction,
  type ContractFunctionsByNamespace,
} from "../abi/routes.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredUiDocument,
} from "./resources.ts"
import {
  validateUiTypeflow,
} from "./typeflow.ts"

const TRANSACTION_VALUE_INPUT_BASE = "transactionValue"
const TRANSACTION_VALUE_ABI = {
  name: TRANSACTION_VALUE_INPUT_BASE,
  type: "uint256",
} as const

export function validateVersionedUiTypeflow({
  uiDocument,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly uiDocument: DeclaredUiDocument | undefined
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  const surface = valueTypeflowSurface(routes, functionsByNamespace)
  validateUiTypeflow({
    uiDocument,
    routes: surface.routes,
    functionsByNamespace: surface.functionsByNamespace,
    issues,
  })
}

function valueTypeflowSurface(
  routes: readonly DeclaredRoute[],
  functionsByNamespace: ContractFunctionsByNamespace,
): {
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
} {
  const candidates = routes.flatMap((route) => {
    if (
      route.kind !== "write"
      || !camVersionSupportsWriteValue(route.version)
      || !Object.hasOwn(route, "value")
    ) {
      return []
    }

    const functions = functionsByNamespace.get(route.call.namespace)
    const fn = functions === undefined ? undefined : resolvedAbiFunction(route.call.function, functions)
    return fn?.stateMutability === "payable" ? [{ route, fn }] : []
  })
  if (candidates.length === 0) {
    return { routes, functionsByNamespace }
  }

  const inputName = unusedTransactionValueInputName(routes, functionsByNamespace)
  const candidateRouteNames = new Set(candidates.map(({ route }) => route.name))
  const typeflowRoutes = routes.map((route) => {
    if (!candidateRouteNames.has(route.name)) return route
    return {
      ...route,
      call: {
        ...route.call,
        args: {
          ...route.call.args,
          [inputName]: route.value,
        },
      },
    }
  })

  let typeflowFunctions = functionsByNamespace
  const augmentedSignatures = new Set<string>()
  for (const { route, fn } of candidates) {
    if (augmentedSignatures.has(`${route.call.namespace}:${fn.signature}`)) continue
    augmentedSignatures.add(`${route.call.namespace}:${fn.signature}`)
    typeflowFunctions = addTransactionValueInput(
      typeflowFunctions,
      route.call.namespace,
      fn,
      inputName,
    )
  }

  return {
    routes: typeflowRoutes,
    functionsByNamespace: typeflowFunctions,
  }
}

function addTransactionValueInput(
  functionsByNamespace: ContractFunctionsByNamespace,
  namespace: string,
  fn: AbiFunction,
  inputName: string,
): ContractFunctionsByNamespace {
  const functions = functionsByNamespace.get(namespace)
  if (functions === undefined) return functionsByNamespace
  const overloads = functions.get(fn.name)
  if (overloads === undefined) return functionsByNamespace

  const nextFunctions = new Map(functions)
  nextFunctions.set(fn.name, overloads.map((candidate) => {
    if (candidate.signature !== fn.signature) return candidate
    return {
      ...candidate,
      inputs: [
        ...candidate.inputs,
        {
          ...TRANSACTION_VALUE_ABI,
          name: inputName,
          abi: {
            ...TRANSACTION_VALUE_ABI,
            name: inputName,
          },
        },
      ],
    }
  }))

  const nextNamespaces = new Map(functionsByNamespace)
  nextNamespaces.set(namespace, nextFunctions)
  return nextNamespaces
}

function unusedTransactionValueInputName(
  routes: readonly DeclaredRoute[],
  functionsByNamespace: ContractFunctionsByNamespace,
): string {
  const used = new Set<string>()
  for (const route of routes) {
    Object.keys(route.call.args).forEach((name) => used.add(name))
  }
  for (const functions of functionsByNamespace.values()) {
    for (const overloads of functions.values()) {
      for (const fn of overloads) {
        fn.inputs.forEach((input) => used.add(input.name))
      }
    }
  }

  let name = TRANSACTION_VALUE_INPUT_BASE
  let suffix = 2
  while (used.has(name)) {
    name = `${TRANSACTION_VALUE_INPUT_BASE}${suffix}`
    suffix += 1
  }
  return name
}
