import { useEffect, useRef, useState } from "react"
import { failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

export function useClipboardCopy(value: string) {
  const attempt = useRef(0)
  const [result, setResult] = useState<"idle" | "pending" | "copied" | FailureReport>("idle")
  useEffect(() => {
    setResult("idle")
    return () => { attempt.current++ }
  }, [value])

  async function copy(): Promise<void> {
    const current = ++attempt.current
    setResult("pending")
    try {
      if (navigator.clipboard === undefined) throw new UserFacingError("Clipboard access is unavailable in this browser.")
      await navigator.clipboard.writeText(value)
      if (attempt.current === current) setResult("copied")
    } catch (cause) {
      if (attempt.current === current) setResult(failureReport(cause, "Cannot copy this value. Select and copy it manually."))
    }
  }

  return { result, copy, failure: typeof result === "object" ? result : undefined }
}
