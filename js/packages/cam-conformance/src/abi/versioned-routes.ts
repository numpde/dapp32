import {
  camVersionSupportsWriteValue,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import {
  abiArgValueMismatches,
  resolvedAbiFunction,
  validateRouteAbiCompatibility,
  type AbiFunction,
  type ContractFunctionsByNamespace,
} from "./routes.ts"

const TRANSACTION_VALUE_ABI = {
  name: "value",
  type: "uint256",
} as const

const RULES = conformanceRules({
  CAM_ROUTE_VALUE_MISMATCH: {
    class: "A",
    reason: "CAM 1.1 write value presence and static shape must agree with the target ABI mutability.",
  },
})

export function validateVersionedRouteAbiCompatibility({
  resource,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly resource: string
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  for (const route of routes) {
    const fn = routeFunction(route, functionsByNamespace)
    validateRouteAbiCompatibility({
      resource,
      routes: [route],
      functionsByNamespace: compatibilityFunctions(route, fn, functionsByNamespace),
      issues,
    })
    validateRouteValue(resource, route, fn, issues)
  }
}

function validateRouteValue(
  resource: string,
  route: DeclaredRoute,
  fn: AbiFunction | undefined,
  issues: CamConformanceIssue[],
): void {
  if (route.kind !== "write" || !camVersionSupportsWriteValue(route.version) || fn === undefined) return

  if (fn.stateMutability === "payable") {
    if (!Object.hasOwn(route, "value")) {
      issues.push(routeValueIssue(
        resource,
        route,
        `payable write route must declare value: ${fn.name}`,
      ))
      return
    }

    for (const mismatch of abiArgValueMismatches("transaction value", route.value, TRANSACTION_VALUE_ABI)) {
      issues.push(routeValueIssue(resource, route, mismatch.message, mismatch.pathSuffix))
    }
    return
  }

  if (fn.stateMutability === "nonpayable" && Object.hasOwn(route, "value")) {
    issues.push(routeValueIssue(
      resource,
      route,
      `nonpayable write route must not declare value: ${fn.name}`,
    ))
  }
}

function routeFunction(
  route: DeclaredRoute,
  functionsByNamespace: ContractFunctionsByNamespace,
): AbiFunction | undefined {
  const functions = functionsByNamespace.get(route.call.namespace)
  return functions === undefined ? undefined : resolvedAbiFunction(route.call.function, functions)
}

function compatibilityFunctions(
  route: DeclaredRoute,
  fn: AbiFunction | undefined,
  functionsByNamespace: ContractFunctionsByNamespace,
): ContractFunctionsByNamespace {
  // The existing route ABI validator owns all ordinary ABI joins and retains
  // CAM 1.0's nonpayable-only write rule. For a CAM 1.1 payable write, present a
  // mutability-normalized view so that validator can check function resolution,
  // arguments, and output references without emitting the obsolete 1.0 rule;
  // validateRouteValue above remains authoritative for the real mutability.
  if (
    route.kind !== "write"
    || !camVersionSupportsWriteValue(route.version)
    || fn?.stateMutability !== "payable"
  ) {
    return functionsByNamespace
  }

  const functions = functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return functionsByNamespace
  const overloads = functions.get(fn.name)
  if (overloads === undefined) return functionsByNamespace

  const normalizedFunctions = new Map(functions)
  normalizedFunctions.set(fn.name, overloads.map((candidate) =>
    candidate.signature === fn.signature
      ? { ...candidate, stateMutability: "nonpayable" as const }
      : candidate
  ))

  const normalizedNamespaces = new Map(functionsByNamespace)
  normalizedNamespaces.set(route.call.namespace, normalizedFunctions)
  return normalizedNamespaces
}

function routeValueIssue(
  resource: string,
  route: DeclaredRoute,
  message: string,
  pathSuffix = "",
): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_VALUE_MISMATCH,
    resource,
    path: `routes.${route.name}.value${pathSuffix}`,
    message,
  })
}
