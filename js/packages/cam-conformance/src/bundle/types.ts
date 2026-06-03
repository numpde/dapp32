export type CamConformanceBundle = {
  readonly mainURI: string
  readonly mainBytes: Uint8Array
  readonly resources: ReadonlyMap<string, Uint8Array>
}
