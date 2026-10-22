import type { AbiFunction, Address } from "viem"

import type {
  CamRoute,
} from "../../packages/cam-core/dist/index.js"
import {
  forEachResolvedUiNode,
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import type { ResolvedButtonNode } from "../../packages/cam-screen/dist/index.js"
import type { ResolvedCamContract } from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import {
  toInertValue,
  abiFunctionSignature,
  abiScalarKind,
  isAbiFunctionSignatureReference,
  parseExpressionReference,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  InertRecord,
  InertValue,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  Prng,
} from "./prng.ts"

export type ValueGenerationMode = "broad" | "write-positive"

export function generatedRouteInputs({
  route,
  contracts,
  account,
  prng,
  mode,
}: {
  readonly route: CamRoute | undefined
  readonly contracts: Record<string, ResolvedCamContract>
  readonly account: Address
  readonly prng: Prng
  readonly mode: ValueGenerationMode
}): InertRecord {
  if (route === undefined) {
    throw new Error("cannot generate inputs for missing route")
  }

  const inputs: Record<string, InertValue> = {}
  const types = directRouteInputTypes(route, contracts)
  for (const name of route.inputs) {
    inputs[name] = generatedAbiValue(types.get(name), name, account, prng, mode)
  }

  return toInertValue(inputs) as InertRecord
}

export function generatedStatePatch({
  snapshot,
  routes,
  contracts,
  account,
  prng,
  mode,
}: {
  readonly snapshot: CamViewerSnapshot
  readonly routes: Record<string, CamRoute>
  readonly contracts: Record<string, ResolvedCamContract>
  readonly account: Address
  readonly prng: Prng
  readonly mode: ValueGenerationMode
}): InertRecord {
  const resolved = snapshot.resolvedUi
  if (resolved === undefined) {
    throw new Error("cannot generate state values without resolved UI")
  }

  const patch: Record<string, InertValue> = {}
  const renderedKeys = new Set<string>()
  forEachResolvedUiNode(resolved, node => {
    if ((node.element === "TextField" || node.element === "AmountField" || node.element === "NonNegativeIntegerField" || node.element === "DurationField") && node.disabled !== true) renderedKeys.add(node.state.key)
  })
  const types = directStateTypes(resolvedUiButtons(resolved), renderedKeys, routes, contracts)
  forEachResolvedUiNode(resolved, (node) => {
    if ("disabled" in node && node.disabled === true) return
    if (node.element === "NonNegativeIntegerField" || node.element === "DurationField") {
      let minimum = 0n
      let maximum: bigint | undefined
      const type = types.get(node.state.key)
      if (type !== undefined) {
        const integer = parseAbiIntegerType(type)
        if (integer === undefined) throw new Error(`Cannot generate numeric control ${node.state.key}: the generator requires an integer ABI binding, not ${type}`)
        maximum = (1n << BigInt(integer.bits - (integer.signed ? 1 : 0))) - 1n
      }
      if (node.props.min !== undefined) minimum = BigInt(node.props.min)
      if (node.props.max !== undefined) {
        const fieldMaximum = BigInt(node.props.max)
        if (maximum === undefined || fieldMaximum < maximum) maximum = fieldMaximum
      }
      if (maximum !== undefined && minimum > maximum) throw new Error(`Cannot generate numeric control ${node.state.key}: UI and ABI bounds have no shared nonnegative range`)
      let candidate = node.element === "DurationField" ? 3600n : 1n
      if (candidate < minimum) candidate = minimum
      if (maximum !== undefined && candidate > maximum) candidate = maximum
      patch[node.state.key] = mode === "broad" ? prng.pick(["", candidate.toString()]) : candidate.toString()
    } else if (node.element === "TextField" || node.element === "AmountField") {
      patch[node.state.key] = generatedAbiValue(types.get(node.state.key), node.state.key, account, prng, mode)
    }
  })

  return toInertValue(patch) as InertRecord
}

function directRouteInputTypes(route: CamRoute, contracts: Record<string, ResolvedCamContract>): Map<string, string> {
  const types = new Map<string, string>()
  const invocations = [route.call]
  if (route.kind === "write" && route.resolve !== undefined) invocations.push(route.resolve)
  for (const invocation of invocations) {
    const bindings = Object.entries(invocation.args).flatMap(([name, value]) => {
      const input = directReference(value, "inputs")
      return input === undefined ? [] : [{ name, input }]
    })
    if (bindings.length === 0) continue
    const contract = contracts[invocation.namespace]
    if (contract === undefined) throw new Error(`Cannot generate route inputs: namespace is unresolved: ${invocation.namespace}`)
    const matches = contract.abi.filter((item): item is AbiFunction => item.type === "function" && (
      isAbiFunctionSignatureReference(invocation.function)
        ? abiFunctionSignature(item) === invocation.function
        : item.name === invocation.function
    ))
    if (matches.length !== 1) throw new Error(`Cannot generate route inputs without one unambiguous ABI function: ${invocation.namespace}.${invocation.function}`)
    const fn = matches[0]!
    for (const binding of bindings) {
      const input = fn.inputs.find(input => input.name === binding.name)
      if (input === undefined) throw new Error(`Cannot generate route input ${binding.input}: ABI argument is missing: ${invocation.function}.${binding.name}`)
      bindType(types, binding.input, input.type)
    }
  }
  return types
}

function directStateTypes(
  buttons: readonly ResolvedButtonNode[],
  renderedKeys: ReadonlySet<string>,
  routes: Record<string, CamRoute>,
  contracts: Record<string, ResolvedCamContract>,
): Map<string, string> {
  const types = new Map<string, string>()
  // Only the actual rendered action instances constrain these controls.
  // Include parameter flow and nested expressions remain outside this generator.
  for (const button of buttons) {
    if (button.disabled === true) continue
    const route = routes[button.call.function]
    if (route === undefined) continue
    const inputTypes = directRouteInputTypes(route, contracts)
    for (const [input, key] of Object.entries(button.directStateBindings ?? {})) {
      const type = inputTypes.get(input)
      if (renderedKeys.has(key) && type !== undefined) bindType(types, key, type)
    }
  }
  return types
}

function directReference(value: InertValue, root: string): string | undefined {
  if (typeof value !== "string") return undefined
  const reference = parseExpressionReference(value, { numericSegments: true })
  return reference?.root === root && reference.segments.length === 1 ? reference.segments[0] : undefined
}

function bindType(types: Map<string, string>, name: string, type: string): void {
  const previous = types.get(name)
  if (previous !== undefined && previous !== type) throw new Error(`Cannot generate conflicting types for ${name}: ${previous} and ${type}`)
  types.set(name, type)
}

function generatedAbiValue(
  type: string | undefined,
  name: string,
  account: Address,
  prng: Prng,
  mode: ValueGenerationMode,
): InertValue {
  if (type === undefined || type === "string") return generatedNamedValue(name, account, prng, mode)
  if (type === "address") return account
  if (type === "bool") return prng.pick([false, true])
  if (abiScalarKind(type) === "integer") return "1"
  if (type === "bytes") return "0x"
  const bytes = parseAbiFixedBytesLength(type)
  if (bytes !== undefined) return `0x${"11".repeat(bytes)}`
  throw new Error(`Cannot generate input ${name}: the workflow generator supports direct scalar ABI bindings, not ${type}`)
}

function generatedNamedValue(name: string, account: Address, prng: Prng, mode: ValueGenerationMode): InertValue {
  const lower = name.toLowerCase()
  if (lower.includes("account") || lower.includes("owner") || lower.includes("address")) {
    return account
  }
  if (lower.includes("uri")) {
    return `fixture://cam-integration/${1 + prng.integer(3)}.json`
  }
  if (lower.includes("serial")) {
    if (mode === "write-positive") {
      return prng.pick(["CAM-TEST-001", "CAM-TEST-002"])
    }
    return prng.pick(["", "CAM-TEST-001", "CAM-TEST-002"])
  }

  // Write-enabled fuzz validates presented writes, so generated values should
  // exercise legitimate fixture paths. Broad mode keeps invalid strings in the
  // corpus so read-only walks still observe negative simulations.
  if (mode === "write-positive") {
    return prng.pick(["CAM-TEST-001", "1"])
  }

  return prng.pick(["", "CAM-TEST-001", "1"])
}
