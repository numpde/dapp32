import { useEffect, useState } from "react"
import type { ReactElement } from "react"
import { Icon } from "./icon.tsx"

type Appearance = "light" | "dark"

// Follow the device until a switch activation chooses a persistent override.
export function AppearanceControl(): ReactElement {
  // The prepaint script validates stored choices before setting this attribute.
  const [appearance, setAppearance] = useState<Appearance | undefined>(
    () => document.documentElement.dataset.appearance as Appearance | undefined,
  )
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = (): void => setSystemDark(media.matches)
    media.addEventListener("change", update)
    update()
    return () => media.removeEventListener("change", update)
  }, [])

  const dark = appearance === "dark" || (appearance === undefined && systemDark)

  function selectAppearance(next: Appearance): void {
    document.documentElement.dataset.appearance = next
    setAppearance(next)
    // Restricted browser storage must not prevent the user changing the theme.
    try {
      localStorage.setItem("cam-viewer-appearance", next)
    } catch { /* The choice still applies to this page. */ }
  }

  return <div className="appearance-control">
    <span>Appearance</span>
    <button type="button" role="switch" className="appearance-switch"
      aria-label="Dark appearance" aria-checked={dark}
      title={dark ? "Switch to light appearance" : "Switch to dark appearance"}
      onClick={() => selectAppearance(dark ? "light" : "dark")}>
      <span className="appearance-track" aria-hidden="true">
        <span className="appearance-knob"><Icon name={dark ? "moon" : "sun"} /></span>
      </span>
    </button>
  </div>
}
