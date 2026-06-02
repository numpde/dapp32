export type CamConformanceIssue = {
  readonly severity: string
  readonly message: string
  readonly path?: string
}

export type CamConformanceReport = {
  readonly issues: readonly CamConformanceIssue[]
}
