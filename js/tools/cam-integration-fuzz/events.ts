type JsonObject = {
  readonly [key: string]: unknown
}

export function emit(event: JsonObject): void {
  console.log(JSON.stringify({
    source: "cam-integration-fuzz",
    ...event,
  }))
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  // The runner emits JSON events consumed by humans and CI logs. Keep failures
  // replay-focused instead of leaking container-local stack paths into the
  // event stream.
  return error.message
}

