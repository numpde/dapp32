import { useCallback, useEffect, useRef, useState } from "react"

type SettledResource<T> = { readonly status: "idle" } | { readonly status: "ready"; readonly value: T } | { readonly status: "failed"; readonly error: unknown; readonly value?: T }
export type Resource<T> = SettledResource<T> | { readonly status: "pending"; readonly previous: SettledResource<T> }

export function useResource<T>() {
  const [resource, setResource] = useState<Resource<T>>({ status: "idle" })
  const pending = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => pending.current?.abort(), [])
  const cancel = useCallback((): void => {
    pending.current?.abort()
    setResource(current => current.status === "pending" ? current.previous : { status: "idle" })
  }, [])
  const run = useCallback(async (acquire: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setResource(current => ({ status: "pending", previous: current.status === "pending" ? current.previous : current }))
    try {
      const value = await acquire(controller.signal)
      if (controller.signal.aborted) return undefined
      setResource({ status: "ready", value })
      return value
    } catch (error) {
      if (!controller.signal.aborted) setResource(current => {
        const previous = current.status === "pending" ? current.previous : current
        return { status: "failed", error, ...(previous.status !== "idle" && previous.value !== undefined ? { value: previous.value } : {}) }
      })
    }
    return undefined
  }, [])
  const settled = resource.status === "pending" ? resource.previous : resource
  return { resource, settled, value: settled.status === "idle" ? undefined : settled.value, run, cancel }
}
