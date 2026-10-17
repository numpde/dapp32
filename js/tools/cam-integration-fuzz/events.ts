import { viewerErrorMessage } from "../../packages/cam-viewer/dist/index.js"

export type JsonObject = {
  readonly [key: string]: unknown
}

const MAX_EVENT_ERROR_LENGTH = 1_000

export function emit(event: JsonObject): void {
  console.log(JSON.stringify({
    source: "cam-integration-fuzz",
    ...event,
  }))
}

export function errorMessage(error: unknown): string {
  const message = viewerErrorMessage(error)
  return message.length <= MAX_EVENT_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_EVENT_ERROR_LENGTH)}...`
}
