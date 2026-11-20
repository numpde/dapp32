import react from "@vitejs/plugin-react"
import { Readable } from "node:stream"
import { SitemapStream, streamToPromise } from "sitemap"
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

export function replacePlaceholders(template, values) {
  return template.replace(/%([A-Z][A-Z0-9_]*)%/g, (placeholder, name) => {
    const value = values[name]
    if (value === undefined || value === "") {
      throw new Error(`Cannot build viewer template: no value was supplied for ${placeholder}.`)
    }
    return value
  })
}

export function viewerConfig(env = process.env) {
  const origin = env.VIEWER_PUBLIC_ORIGIN
  const values = origin ? { ...env, VIEWER_PUBLIC_ORIGIN: requireHttpOrigin(origin, "VIEWER_PUBLIC_ORIGIN") } : env
  const homepage = origin ? replacePlaceholders("%VIEWER_PUBLIC_ORIGIN%/", values) : undefined
  return {
    // One bundle works at the stand-alone root and under /dapp32/viewer/ on Pages.
    base: "./",
    plugins: [react(), {
      name: "viewer-crawlers",
      apply: "build",
      transformIndexHtml(html) {
        return {
          html: replacePlaceholders(html, values),
          tags: homepage === undefined ? [] : [{
            tag: "link", attrs: { rel: "canonical", href: homepage }, injectTo: "head",
          }],
        }
      },
      async generateBundle() {
        let robots = "User-agent: *\nDisallow:\n"
        if (homepage !== undefined) {
          const pages = Readable.from([{ url: homepage }])
          const source = await streamToPromise(pages.pipe(new SitemapStream()))
          this.emitFile({ type: "asset", fileName: "sitemap.xml", source })
          robots += replacePlaceholders("\nSitemap: %VIEWER_PUBLIC_ORIGIN%/sitemap.xml\n", values)
        }
        this.emitFile({ type: "asset", fileName: "robots.txt", source: robots })
      },
    }],
    server: {
      host: "0.0.0.0",
      port: 5173,
      strictPort: true,
      // The browser gateway forwards the public Host header. Accept only the
      // operator-declared GUI origin plus loopback defaults, never every host.
      allowedHosts: [...allowedHosts(env)],
    },
  }
}

export default defineConfig(() => viewerConfig())
