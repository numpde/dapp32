import {
  diffNameSets,
} from "../names.ts"
import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  UI_RUNTIME_ROOTS,
} from "@cam/protocol"

export type UiCallNamespace = "routes" | "ui"

export function validateUiCallArgNames({
  resource,
  path,
  namespace,
  args,
  issues,
  rule,
}: {
  readonly resource: string
  readonly path: string
  readonly namespace: UiCallNamespace
  readonly args: Record<string, unknown>
  readonly issues: CamConformanceIssue[]
  readonly rule: string
}): boolean {
  // Callers must not pass "" keys; this is invalid regardless of namespace and
  // blocks silent behavior where route/input binding silently drops an arg.
  if (Object.prototype.hasOwnProperty.call(args, "")) {
    issues.push(callIssue(resource, rule, `${path}.call.args`, "UI call argument name must not be empty"))
    return false
  }

  if (namespace !== "ui") return true

  // Include targets receive a literal argument map; shadowing runtime roots would
  // make downstream expressions ambiguous and hard to audit.
  for (const name of Object.keys(args)) {
    if (UI_RUNTIME_ROOTS.has(name)) {
      issues.push(callIssue(resource, rule, `${path}.call.args.${name}`, `UI call argument must not shadow runtime root: ${name}`))
      return false
    }
  }

  return true
}

export function validateUiCallFunctionShape({
  resource,
  path,
  namespace,
  value,
  issues,
  rule,
}: {
  readonly resource: string
  readonly path: string
  readonly namespace: UiCallNamespace
  readonly value: unknown
  readonly issues: CamConformanceIssue[]
  readonly rule: string
}): boolean {
  if (typeof value === "string") return true

  // Include calls intentionally accept literal single or multiple targets; button
  // calls are intentionally singular (one route per click).
  if (namespace === "ui" && Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return true
    issues.push(callIssue(resource, rule, `${path}.call.function`, "UI Include target must be a string or string array"))
    return false
  }

  issues.push(callIssue(
    resource,
    rule,
    `${path}.call.function`,
    namespace === "ui"
      ? "UI Include target must be a string or string array"
      : "UI Button route target must be a string",
  ))
  return false
}

export function validateStaticCallTargets({
  resource,
  path,
  label,
  names,
  issues,
  rule,
}: {
  readonly resource: string
  readonly path: string
  readonly label: string
  readonly names: readonly string[]
  readonly issues: CamConformanceIssue[]
  readonly rule: string
}): boolean {
  let valid = true
  const seen = new Set<string>()
  for (const name of names) {
    if (name.length === 0) {
      issues.push(callIssue(resource, rule, path, `${label} target must not be empty`))
      valid = false
    } else if (seen.has(name)) {
      issues.push(callIssue(resource, rule, path, `${label} target must not be duplicated: ${name}`))
      valid = false
    }
    seen.add(name)
  }

  return valid
}

export function validateExpectedArgumentNames({
  resource,
  path,
  expectedNames,
  actualNames,
  destination,
  issues,
  rule,
  filterEmptyActualNames,
}: {
  readonly resource: string
  readonly path: string
  readonly expectedNames: readonly string[]
  readonly actualNames: readonly string[]
  readonly destination: string
  readonly issues: CamConformanceIssue[]
  readonly rule: string
  readonly filterEmptyActualNames: boolean
}): void {
  // Route/UI handoff checks are name-set contracts. Empty keys are validated in
  // the call-shape phase; only strict name-membership is compared here.
  const filteredActualNames = filterEmptyActualNames ? actualNames.filter((name) => name.length > 0) : actualNames
  diffNameSets({
    expectedNames,
    actualNames: filteredActualNames,
    onUnexpected: (name) => {
      issues.push(callIssue(resource, rule, `${path}.${name}`, `unexpected UI call argument for ${destination}: ${name}`))
    },
    onMissing: (name) => {
      issues.push(callIssue(resource, rule, `${path}.${name}`, `missing UI call argument for ${destination}: ${name}`))
    },
  })
}

function callIssue(resource: string, rule: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule,
    resource,
    path,
    message,
  })
}
