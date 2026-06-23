export type CamConformanceRuleCode = `CAM_${string}`

type CamConformanceRuleDetails =
  | CamConformanceRetainedRuleDetails
  | CamConformanceQuestionableRuleDetails
  | CamConformanceRejectedRuleDetails

type CamConformanceRetainedRuleDetails = {
  readonly class: "A"
  readonly reason: string
}

type CamConformanceQuestionableRuleDetails = {
  readonly class: "B"
  readonly reason: string
  readonly limitation: string
}

type CamConformanceRejectedRuleDetails = {
  readonly class: "C"
  readonly reason: string
}

type CamConformanceRuleKey<Rules> = keyof Rules & CamConformanceRuleCode

type CamConformanceRuleMap<Rules extends Readonly<Record<CamConformanceRuleCode, CamConformanceRuleDetails>>> = {
  readonly [Code in CamConformanceRuleKey<Rules>]: Code
}

export type CamConformanceIssue = {
  readonly rule: CamConformanceRuleCode
  readonly severity: "error"
  readonly resource: string
  readonly message: string
  readonly path?: string
}

export class CamConformanceError extends Error {
  readonly issues: readonly CamConformanceIssue[]

  constructor(issues: readonly CamConformanceIssue[]) {
    super(formatIssueSummary(issues))
    this.name = "CamConformanceError"
    this.issues = issues
  }
}

export function conformanceIssue({
  rule,
  resource,
  path,
  message,
}: {
  readonly rule: CamConformanceRuleCode
  readonly resource: string
  readonly path?: string | undefined
  readonly message: string
}): CamConformanceIssue {
  const issue = {
    rule,
    severity: "error",
    resource,
    message,
  } satisfies Omit<CamConformanceIssue, "path">

  if (path === undefined) {
    return issue
  }

  return {
    ...issue,
    path,
  }
}

export function issueFromError({
  rule,
  resource,
  path,
  error,
}: {
  readonly rule: CamConformanceRuleCode
  readonly resource: string
  readonly path?: string
  readonly error: unknown
}): CamConformanceIssue {
  const resolvedPath = path === undefined ? errorPath(error) : path
  return conformanceIssue({
    rule,
    resource,
    path: resolvedPath,
    message: errorMessage(error),
  })
}

export function conformanceRules<const Rules extends Readonly<Record<CamConformanceRuleCode, CamConformanceRuleDetails>>>(
  rules: Rules,
): CamConformanceRuleMap<Rules> {
  // Class/reason is maintainer-facing ownership metadata. Runtime issues
  // intentionally carry only the stable public CAM_* rule code.
  const ruleCodes: Partial<Record<CamConformanceRuleKey<Rules>, CamConformanceRuleCode>> = {}
  for (const rule of Object.keys(rules) as readonly CamConformanceRuleKey<Rules>[]) {
    const details = rules[rule]
    if (details.class === "C") {
      throw new Error(`Class C CAM conformance rule must be removed or moved to its runtime owner: ${rule}`)
    }
    if (details.reason.trim().length === 0) {
      throw new Error(`CAM conformance rule must justify its ownership: ${rule}`)
    }
    if (details.class === "B" && (details.limitation === undefined || details.limitation.trim().length === 0)) {
      throw new Error(`Class B CAM conformance rule must document its limitation: ${rule}`)
    }
    ruleCodes[rule] = rule
  }
  return ruleCodes as CamConformanceRuleMap<Rules>
}

function errorPath(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "path" in error) {
    const path = error.path
    if (typeof path === "string" && path.length > 0) {
      return path
    }
  }

  return undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatIssueSummary(issues: readonly CamConformanceIssue[]): string {
  const first = issues[0]
  if (first === undefined) {
    return "CAM conformance failed"
  }

  return `CAM conformance failed with ${issues.length} issue(s): ${first.rule}: ${first.message}`
}
