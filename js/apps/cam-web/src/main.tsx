import { StrictMode } from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"

import { App } from "./App.tsx"
import { BuildFooter } from "./build-footer.tsx"
import { AppearanceControl } from "./appearance.tsx"

const root = document.getElementById("root")
if (root === null) {
  throw new Error("missing root element")
}
const appearance = document.getElementById("viewer-appearance")
if (appearance === null) {
  throw new Error("Cannot start CAM Viewer because the page is missing the #viewer-appearance element.")
}

createRoot(root).render(
  <StrictMode>
    {createPortal(<AppearanceControl />, appearance)}
    <App />
    <BuildFooter revision={import.meta.env.VITE_CAM_WEB_BUILD_REVISION} builtAt={import.meta.env.VITE_CAM_WEB_BUILD_TIME} modified={import.meta.env.VITE_CAM_WEB_BUILD_MODIFIED === "true"} development={import.meta.env.DEV} />
  </StrictMode>,
)
