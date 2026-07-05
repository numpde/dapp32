import type { Address } from "viem"

import type {
  CamRoute,
} from "../../packages/cam-core/dist/index.js"
import {
  resolvedUiInputNames,
} from "../../packages/cam-screen/dist/index.js"
import type {
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import {
  toInertValue,
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
  account,
  prng,
  mode,
}: {
  readonly route: CamRoute | undefined
  readonly account: Address
  readonly prng: Prng
  readonly mode: ValueGenerationMode
}): InertRecord {
  if (route === undefined) {
    throw new Error("cannot generate inputs for missing route")
  }

  const inputs: Record<string, InertValue> = {}
  for (const name of route.inputs) {
    inputs[name] = generatedNamedValue(name, account, prng, mode)
  }

  return toInertValue(inputs) as InertRecord
}

export function generatedStatePatch({
  snapshot,
  account,
  prng,
  mode,
}: {
  readonly snapshot: CamViewerSnapshot
  readonly account: Address
  readonly prng: Prng
  readonly mode: ValueGenerationMode
}): InertRecord {
  const resolved = snapshot.resolvedUi
  if (resolved === undefined) {
    throw new Error("cannot generate state values without resolved UI")
  }

  const patch: Record<string, InertValue> = {}
  for (const name of resolvedUiInputNames(resolved)) {
    patch[name] = generatedNamedValue(name, account, prng, mode)
  }

  return toInertValue(patch) as InertRecord
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
