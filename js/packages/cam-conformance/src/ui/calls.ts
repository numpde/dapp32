import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  diffNameSets,
  nameListShapeIssues,
  UI_CALL_NAMESPACE_BY_ELEMENT,
  UI_RUNTIME_ROOTS,
  type UiCallNamespace,
} from "@cam/protocol"

export type {
  UiCallNamespace,
}

export const UI_CALL_RULES = conformanceRules({
  CAM_UI_DATAFLOW_MISMATCH: {
    class: "A",
    reason: "UI dataflow checks static Include/Button name-set contracts and local state key names.",
  },
  CAM_UI_TYPEFLOW_MISMATCH: {
    class: "A",
    reason: "UI typeflow reports only route-local facts proven from ABI, literal, or known handoff values.",
  },
})

export type UiCallValidationRule =
  | typeof UI_CALL_RULES.CAM_UI_DATAFLOW_MISMATCH
  | typeof UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH

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
  readonly rule: UiCallValidationRule
}): boolean {
  // Callers must not pass "" keys; this is invalid regardless of namespace and
  // blocks silent behavior where route/input binding silently drops an arg.
  if (Object.hasOwn(args, "")) {
    issues.push(callIssue(resource, rule, `${path}.call.args`, "UI call argument name must not be empty"))
    return false
  }

  if (namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Include) return true

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
  readonly rule: UiCallValidationRule
}): boolean {
  if (typeof value === "string") return true

  // Include calls intentionally accept literal single or multiple targets; button
  // calls are intentionally singular (one route per click).
  if (namespace === UI_CALL_NAMESPACE_BY_ELEMENT.Include && Array.isArray(value)) {
    if (value.every((item) => typeof item === "string")) return true
    issues.push(callIssue(resource, rule, `${path}.call.function`, "UI Include target must be a string or string array"))
    return false
  }

  issues.push(callIssue(
    resource,
    rule,
    `${path}.call.function`,
    namespace === UI_CALL_NAMESPACE_BY_ELEMENT.Include
      ? "UI Include target must be a string or string array"
      : "UI Button route target must be a string",
  ))
  return false
}

export function validateKnownCallTargets({
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
  readonly rule: UiCallValidationRule
}): boolean {
  let valid = true
  for (const issue of nameListShapeIssues(names)) {
    if (issue.kind === "empty") {
      issues.push(callIssue(resource, rule, path, `${label} target must not be empty`))
      valid = false
    } else {
      issues.push(callIssue(resource, rule, path, `${label} target must not be duplicated: ${issue.name}`))
      valid = false
    }
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
  readonly rule: UiCallValidationRule
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

function callIssue(resource: string, rule: UiCallValidationRule, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule,
    resource,
    path,
    message,
  })
}
