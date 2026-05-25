import { CamEvmError } from "./errors.ts"

type JsonParseErrorCode = "CAM_ABI_INVALID" | "CAM_DOCUMENT_INVALID"

export function parseJsonBytes(bytes: Uint8Array, errorCode: JsonParseErrorCode, message: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (cause) {
    throw new CamEvmError(errorCode, message, cause)
  }
}
