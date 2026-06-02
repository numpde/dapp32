export type CamConformanceIssue = {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export type CamConformanceReport = {
  readonly ok: boolean
  readonly issues: readonly CamConformanceIssue[]
}

export function emptyConformanceReport(): CamConformanceReport {
  return {
    ok: true,
    issues: [],
  }
}
