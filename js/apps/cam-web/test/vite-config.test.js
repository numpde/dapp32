import assert from "node:assert/strict"
import { createReadStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { parseSitemap } from "sitemap"
import { build } from "vite"

import { allowedHosts, replacePlaceholders, viewerConfig } from "../vite.config.js"

test("template variables are replaced everywhere using their supplied values", () => {
  assert.equal(replacePlaceholders("%ORIGIN%/%PAGE%?next=%PAGE%", {
    ORIGIN: "https://viewer.example.test", PAGE: "guide",
  }), "https://viewer.example.test/guide?next=guide")
  for (const values of [{}, { PAGE: "" }]) {
    assert.throws(() => replacePlaceholders("%PAGE%", values), /no value was supplied for %PAGE%/)
  }
})

for (const origin of ["https://viewer.example.test", "https://another.example.test:8443"]) {
  test(`crawler files use the configured public origin ${origin}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "cam-viewer-crawlers-"))
    t.after(() => rm(directory, { recursive: true, force: true }))
    await build({ ...viewerConfig({ VIEWER_PUBLIC_ORIGIN: origin }), configFile: false, logLevel: "silent",
      root: fileURLToPath(new URL("..", import.meta.url)), build: { outDir: directory } })

    const index = await readFile(join(directory, "index.html"), "utf8")
    const canonical = index.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
    assert.equal(canonical, `${origin}/`)
    const pages = await parseSitemap(createReadStream(join(directory, "sitemap.xml")))
    assert.deepEqual(pages.map(page => page.url), [canonical])

    const robots = await readFile(join(directory, "robots.txt"), "utf8")
    assert.equal(robots, `User-agent: *\nDisallow:\n\nSitemap: ${new URL("sitemap.xml", canonical)}\n`)
  })
}

test("generic builds omit deployment-specific canonical and sitemap metadata", async t => {
  const directory = await mkdtemp(join(tmpdir(), "cam-viewer-generic-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await build({ ...viewerConfig({}), configFile: false, logLevel: "silent",
    root: fileURLToPath(new URL("..", import.meta.url)), build: { outDir: directory } })
  assert.doesNotMatch(await readFile(join(directory, "index.html"), "utf8"), /rel="canonical"/)
  assert.equal(await readFile(join(directory, "robots.txt"), "utf8"), "User-agent: *\nDisallow:\n")
  await assert.rejects(readFile(join(directory, "sitemap.xml")), { code: "ENOENT" })
})

test("public origin rejects paths, queries, fragments and credentials", () => {
  for (const origin of ["https://viewer.example.test/path", "https://viewer.example.test?x=1",
    "https://viewer.example.test#top", "https://user:pass@viewer.example.test"]) {
    assert.throws(() => viewerConfig({ VIEWER_PUBLIC_ORIGIN: origin }), /VIEWER_PUBLIC_ORIGIN/)
  }
})

test("Vite dev host allowlist defaults to loopback hosts only", () => {
  assert.deepEqual(allowedHosts({}), ["127.0.0.1", "localhost"])
})

test("Vite dev host allowlist adds only the declared GUI origin host", () => {
  assert.deepEqual(allowedHosts({ CAM_WEB_DEV_ORIGIN: "http://viewer.example.test:5173" }), [
    "127.0.0.1",
    "localhost",
    "viewer.example.test",
  ])
  assert.deepEqual(allowedHosts({ CAM_WEB_DEV_ORIGIN: "http://localhost:5173" }), ["127.0.0.1", "localhost"])
})

test("Vite dev origin policy rejects ambiguous URL shapes", () => {
  const rejected = [
    "ftp://viewer.example.test",
    "http://user@viewer.example.test",
    "http://viewer.example.test/app",
    "http://viewer.example.test?debug=1",
    "http://viewer.example.test#section",
    "http://viewer.example.test/\\admin",
    "http://viewer.example.test/a\nb",
  ]

  for (const origin of rejected) {
    assert.throws(() => allowedHosts({ CAM_WEB_DEV_ORIGIN: origin }), /CAM_WEB_DEV_ORIGIN/)
  }
})
