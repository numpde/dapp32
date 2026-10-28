import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App.tsx"
import { BuildFooter } from "./build-footer.tsx"
import "./styles.css"

const root = document.getElementById("root")
if (root === null) {
  throw new Error("missing root element")
}

createRoot(root).render(
  <StrictMode>
    <App />
    <BuildFooter revision={import.meta.env.VITE_CAM_WEB_BUILD_REVISION} builtAt={import.meta.env.VITE_CAM_WEB_BUILD_TIME} modified={import.meta.env.VITE_CAM_WEB_BUILD_MODIFIED === "true"} development={import.meta.env.DEV} />
  </StrictMode>,
)
