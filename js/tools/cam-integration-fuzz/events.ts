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
  // The runner emits JSON events consumed by humans and CI logs. Keep failures
  // replay-focused and bounded instead of flooding logs with provider payloads.
  let message: string
  try {
    message = error instanceof Error ? error.message : String(error)
  } catch {
    message = "[unprintable error]"
  }
  return message.length <= MAX_EVENT_ERROR_LENGTH
    ? message
    : `${message.slice(0, MAX_EVENT_ERROR_LENGTH)}...`
}
