import {
  createPublicClient,
  http,
} from "viem"

import type { CamPublicClient } from "./types.ts"

export type CreateHttpCamPublicClientOptions = {
  readonly rpcURL: string
}

export function createHttpCamPublicClient({ rpcURL }: CreateHttpCamPublicClientOptions): CamPublicClient {
  return createPublicClient({
    transport: http(rpcURL),
  })
}
