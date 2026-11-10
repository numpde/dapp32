import { useState } from "react"
import type { ReactElement } from "react"

type Appearance = "system" | "light" | "dark"

export function AppearanceControl(): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const selected = document.documentElement.dataset.appearance
    return selected === "light" || selected === "dark" ? selected : "system"
  })

  function selectAppearance(next: Appearance): void {
    if (next === "system") delete document.documentElement.dataset.appearance
    else document.documentElement.dataset.appearance = next
    setAppearance(next)
    // Restricted browser storage must not prevent the user changing the theme.
    try {
      if (next === "system") localStorage.removeItem("cam-viewer-appearance")
      else localStorage.setItem("cam-viewer-appearance", next)
    } catch { /* The choice still applies to this page. */ }
  }

  return <label className="appearance-control">
    Appearance
    <select value={appearance} onChange={event => selectAppearance(event.currentTarget.value as Appearance)}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </label>
}
