import assert from "node:assert/strict"
import test from "node:test"

import { defaultIpfsGateway, publicIpfsGateways } from "../../../tools/ipfs-gateways.ts"
import { createPinnedOriginResourceLoader } from "../src/startup.ts"

test("ordinary downloads exclude retired HTTP gateways and use the public file gateway by default", async t => {
  assert(!publicIpfsGateways.some(gateway => ["ipfs-io", "dweb-link"].includes(gateway.id)))
  const cid = "QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"
  const bytes = new TextEncoder().encode("hello world\n")
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(bytes))
  const loader = createPinnedOriginResourceLoader(undefined, defaultIpfsGateway.template)
  assert.deepEqual(await loader(`ipfs://${cid}`), bytes)
  assert.equal(fetch.mock.calls[0].arguments[0], `https://ipfs.filebase.io/ipfs/${cid}`)
})
