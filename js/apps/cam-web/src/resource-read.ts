import { readBoundedResponseBytes } from "@cam/protocol"

export const RESOURCE_FETCH_OPTIONS = { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store" } as const

export async function readAbortableBoundedBytes(body: ReadableStream<Uint8Array>, signal: AbortSignal, label: string, maxBytes: number): Promise<Uint8Array> {
  if (signal.aborted) {
    void body.cancel().catch(() => {})
    signal.throwIfAborted()
  }
  const reader = body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    signal.throwIfAborted()
    const bytes = await readBoundedResponseBytes({ body: { getReader: () => reader } }, label, maxBytes)
    signal.throwIfAborted()
    return bytes
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

export async function withResourceDeadline<T>(signal: AbortSignal, timeoutReason: Error, cancellationReason: () => unknown, acquire: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const cancel = () => controller.abort(cancellationReason())
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(timeoutReason), 15_000)
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener("abort", rejectAbort, { once: true })
    if (controller.signal.aborted) rejectAbort()
  })
  try {
    return await Promise.race([aborted, (async () => {
      controller.signal.throwIfAborted()
      return acquire(controller.signal)
    })()])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
    controller.signal.removeEventListener("abort", rejectAbort)
  }
}
