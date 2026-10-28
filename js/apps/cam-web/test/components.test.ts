import assert from "node:assert/strict"
import test from "node:test"
import { parseAbi } from "viem"

import { formatInertValue } from "../src/display.ts"
import {
  preparedCallFields,
} from "../src/prepared-call.ts"

const preparedCall = {
  route: "fund",
  address: "0x0000000000000000000000000000000000000001" as const,
  abi: parseAbi(["function fund(uint256 channelId) payable"]),
  function: "fund",
  args: { channelId: "2" },
  then: {
    namespace: "routes",
    function: "entry",
    args: {},
  },
} as const

test("formatInertValue bounds browser display values", () => {
  const long = "x".repeat(2_500)

  assert.equal(formatInertValue(long), `${"x".repeat(2_000)}...`)
  assert.equal(formatInertValue({ text: long }), `${JSON.stringify({ text: long }).slice(0, 2_000)}...`)
})

test("transaction review decodes JSON data URIs without changing numbers or truncating the exact URI", () => {
  const text = '{"name":"Bicycle","number":123456789012345678901234567890,"note":"' + 'x'.repeat(2500) + '"}'
  for (const uri of [`data:application/json;base64,${Buffer.from(text).toString('base64')}`, `data:application/json,${encodeURIComponent(text)}`]) {
    const call = { ...preparedCall, abi: parseAbi(["function fund(string metadata)"]), args: { metadata: uri } }
    const field = preparedCallFields(call).find(field => field.label === 'Input: metadata (string)')!
    assert.equal(field.value, uri)
    assert.deepEqual(field.json, { status: 'ready', text })
  }
})

test("unreadable JSON stays inspectable and other URI types remain inert text", () => {
  const uri = 'data:application/json;base64,broken'
  const call = { ...preparedCall, abi: parseAbi(["function fund(string metadata)"]), args: { metadata: uri } }
  const field = preparedCallFields(call).find(field => field.label === 'Input: metadata (string)')!
  assert.equal(field.value, uri)
  assert.equal(field.json?.status, 'failed')
  assert.equal(preparedCallFields({ ...call, args: { metadata: 'data:text/html,<script>alert(1)</script>' } }).find(field => field.label === 'Input: metadata (string)')?.json, undefined)
})

test("prepared call review discloses native transaction value in wei", () => {
  const fields = preparedCallFields({
    ...preparedCall,
    value: "1000000000000000000",
  })

  assert.deepEqual(fields.find((field) => field.label === "Native amount to send (wei)"), {
    label: "Native amount to send (wei)",
    value: "1000000000000000000",
    mono: true,
  })
})

test("transaction review keeps the target, function and inputs available for inspection", () => {
  const fields = preparedCallFields({ ...preparedCall, args: { channelId: "2" } })
  assert.equal(fields.find(field => field.label === "Contract address")?.value, preparedCall.address)
  assert.equal(fields.find(field => field.label === "Contract function")?.value, "fund")
  assert.equal(fields.find(field => field.label === "Input: channelId (uint256)")?.value, "2")
  assert.equal(fields.find(field => field.label === "App action")?.value, "fund")
  assert.equal(fields.find(field => field.label === "After confirmation")?.value, 'routes.entry {}')
})

test("transaction review matches the selected overload and preserves exact named values", () => {
  const call = {
    ...preparedCall,
    abi: parseAbi(["function fund(address customer)", "function fund(uint256 channelId) payable"]),
    function: "fund(uint256)",
    args: { channelId: "90071992547409931234567890" },
  }
  const fields = preparedCallFields(call)
  assert.equal(fields.find(field => field.label === "Input: channelId (uint256)")?.value, call.args.channelId)
  assert(!fields.some(field => field.label.includes('customer')))
})

test("value-free prepared calls do not invent a transaction amount", () => {
  assert.equal(
    preparedCallFields(preparedCall).some((field) => field.label === "Native amount to send (wei)"),
    false,
  )
})
