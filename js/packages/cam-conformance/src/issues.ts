export type CamConformanceIssue = {
  readonly rule: string
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
  readonly rule: string
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
  readonly rule: string
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
