import { useEffect, useRef, useState } from "react"
import { failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

export type ClipboardCopyResult = "idle" | "pending" | "copied" | FailureReport

export function useClipboardCopy(value: string) {
  const attempt = useRef(0)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [result, setResult] = useState<ClipboardCopyResult>("idle")
  useEffect(() => {
    setResult("idle")
    return () => {
      attempt.current++
      clearTimeout(resetTimer.current)
    }
  }, [value])

  async function copy(): Promise<void> {
    const current = ++attempt.current
    clearTimeout(resetTimer.current)
    setResult("pending")
    try {
      if (navigator.clipboard === undefined) throw new UserFacingError("Clipboard access is unavailable in this browser.")
      await navigator.clipboard.writeText(value)
      if (attempt.current === current) {
        setResult("copied")
        resetTimer.current = setTimeout(() => {
          if (attempt.current === current) setResult("idle")
        }, 2_000)
      }
    } catch (cause) {
      if (attempt.current === current) setResult(failureReport(cause, "Cannot copy this value. Select and copy it manually."))
    }
  }

  return { result, copy, failure: typeof result === "object" ? result : undefined }
}
