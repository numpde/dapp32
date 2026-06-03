export type CamConformanceBundle = {
  readonly rootURI: string
  readonly rootBytes: Uint8Array
  readonly resources: ReadonlyMap<string, Uint8Array>
}
