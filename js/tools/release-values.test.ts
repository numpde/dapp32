import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

const entry = new URL("./release-values.ts", import.meta.url).href
function failure(body: string) {
  return spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", `import {runReleaseTool} from ${JSON.stringify(entry)}; import {HttpRequestError} from 'viem'; function reportedOperation(){${body}} runReleaseTool(async()=>reportedOperation())`], { encoding: "utf8", timeout: 10000, maxBuffer: 100000, env: {} })
}
test("release CLI retains SDK reason and source location without dumping request bodies", () => {
  const result = failure(`throw new HttpRequestError({url:'https://example.test/rpc?token=fixture-token',body:{method:'eth_sendRawTransaction',params:['fixture-private-signature']},details:'upstream DNS lookup failed'})`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /upstream DNS lookup failed/)
  assert.match(result.stderr, /reportedOperation/)
  assert.doesNotMatch(result.stderr, /fixture-token|fixture-private-signature|Request body/)
  assert(result.stderr.indexOf("reportedOperation") > result.stderr.indexOf("upstream DNS lookup failed"))
})
test("release CLI preserves causal diagnostics and refuses an unmatched arbitrary stack", () => {
  const result = failure(`const e=new Error('release operation blocked',{cause:new SyntaxError('invalid document at nodes.app')});e.stack='unmatched stack fixture-private-body';throw e`)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /release operation blocked/)
  assert.match(result.stderr, /invalid document at nodes.app/)
  assert.doesNotMatch(result.stderr, /fixture-private-body|unmatched stack/)
})
