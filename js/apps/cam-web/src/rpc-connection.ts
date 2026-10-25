import type { createPublicClient } from "viem"
import type { CamPublicClient } from "@cam/evm-viem"
import type { CamViewerLoadedSnapshot, CamViewerSession } from "@cam/viewer"

export type RpcEndpoint = {
  readonly url: string
  readonly client: ReturnType<typeof createPublicClient>
}

export function createRpcConnection(initial: RpcEndpoint) {
  let active = initial
  let reader = initial.client
  const client: CamPublicClient = {
    getChainId: () => reader.getChainId(),
    readContract: request => reader.readContract(request),
  }
  return {
    get active(): RpcEndpoint { return active },
    client,
    // The App holds its view-operation gate while a candidate refresh runs.
    async refresh(candidate: RpcEndpoint, session: CamViewerSession): Promise<CamViewerLoadedSnapshot> {
      reader = candidate.client
      try {
        const snapshot = await session.refresh()
        active = candidate
        return snapshot
      } finally { reader = active.client }
    },
  }
}
