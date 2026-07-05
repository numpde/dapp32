import react from "@vitejs/plugin-react"
import { requireHttpOrigin } from "@cam/protocol"
import { defineConfig } from "vite"

const DEFAULT_ALLOWED_HOSTS = ["127.0.0.1", "localhost"]

export function allowedHosts(env = process.env) {
  const origin = env.CAM_WEB_DEV_ORIGIN
  if (origin === undefined || origin.length === 0) {
    return DEFAULT_ALLOWED_HOSTS
  }

  const hostname = new URL(requireHttpOrigin(origin, "CAM_WEB_DEV_ORIGIN")).hostname
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
