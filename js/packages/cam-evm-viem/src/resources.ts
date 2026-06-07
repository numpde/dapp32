import { assertCamResourceSize } from "@cam/protocol"

import { CamEvmError } from "./errors.ts"
import type { ResourceLoader } from "./types.ts"

export async function loadResourceBytes(
  loadResource: ResourceLoader,
  uri: string,
  message: string,
): Promise<Uint8Array> {
  try {
    const bytes = await loadResource(uri)
    assertCamResourceSize(bytes, uri)
    return bytes
  } catch (cause) {
    throw new CamEvmError("CAM_RESOURCE_LOAD_FAILED", message, cause)
  }
}
