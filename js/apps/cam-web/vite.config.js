import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const DEFAULT_ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

function allowedHosts() {
  const origin = process.env.CAM_WEB_DEV_ORIGIN
  if (origin === undefined || origin.length === 0) {
    return DEFAULT_ALLOWED_HOSTS
  }

  let url
  try {
    url = new URL(origin)
  } catch (cause) {
    throw new Error("CAM_WEB_DEV_ORIGIN must be an absolute URL", { cause })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CAM_WEB_DEV_ORIGIN must use http or https")
  }

  const hostname = url.hostname
  return DEFAULT_ALLOWED_HOSTS.includes(hostname)
    ? DEFAULT_ALLOWED_HOSTS
    : [...DEFAULT_ALLOWED_HOSTS, hostname]
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // The browser gateway forwards the public Host header. Accept only the
    // operator-declared GUI origin plus loopback defaults, never every host.
    allowedHosts: allowedHosts(),
  },
})
