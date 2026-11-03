import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseUi, resolveUiNode } from "@cam/screen"
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

test("transaction review keeps complete nested arguments and arrays as indented JSON", () => {
  const params = {
    amount: "90071992547409931234567890",
    terms: { uri: "data:text/plain," + "x".repeat(2500), sha256Digest: "0x" + "ab".repeat(32) },
    agreementRef: "<script>untrusted text</script>",
  }
  const call = {
    ...preparedCall,
    abi: parseAbi(["function fund((uint256 amount, (string uri, bytes32 sha256Digest) terms, string agreementRef) params, uint256[] amounts)"]),
    args: { params, amounts: ["0", params.amount] },
    then: { ...preparedCall.then, args: { params } },
  }
  const before = JSON.stringify(call.args)
  const fields = preparedCallFields(call)
  const tuple = fields.find(field => field.label === "Input: params (tuple)")!
  const next = fields.find(field => field.label === "Next view inputs")!
  assert.equal(next.format, "json")
  assert.equal(next.value, JSON.stringify(call.then.args, null, 2))
  assert.equal(tuple.format, "json")
  assert.equal(tuple.value, JSON.stringify(params, null, 2))
  assert.deepEqual(JSON.parse(tuple.value!), params)
  assert.equal(fields.find(field => field.label === "Input: amounts (uint256[])")?.value, JSON.stringify(call.args.amounts, null, 2))
  assert.equal(JSON.stringify(call.args), before)
  assert.equal(preparedCallFields(preparedCall).find(field => field.label === "Input: channelId (uint256)")?.format, undefined)
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
  assert.equal(fields.find(field => field.label === "After confirmation")?.value, 'routes.entry')
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

test("Escrow creation review explains the prepared parties, amount, durations and terms", async () => {
  const ui = parseUi(JSON.parse(await readFile(new URL("../../../../dapps/escrow/cam/ui.json", import.meta.url), "utf8")))
  const params = {
    agreementRef: "readable-review", contractor: "0x1111111111111111111111111111111111111111",
    arbitrator: "0x2222222222222222222222222222222222222222", amount: "1000000000000",
    acceptanceDuration: "86400", workDuration: "604800", reviewDuration: "172800", arbitrationDuration: "259200",
    terms: { uri: "https://example.test/terms", sha256Digest: "0x" + "ab".repeat(32) },
  }
  for (const timeoutRecipient of ["client", "contractor"]) {
    const review = resolveUiNode(ui, "escrow.create.review", { view: { params, timeoutRecipient } }, {
      host: { chainId: "eip155:31337", address: preparedCall.address }, inputs: {}, outputs: [], state: {},
    })
    assert(review.element === "Screen")
    assert.equal(review.children[0]?.element, "Text")
    const facts = new Map(review.children.slice(1).map(node => {
      assert(node.element === "Status" || node.element === "Address" || node.element === "Uri")
      return [node.props.label, node] as const
    }))
    assert.equal(facts.get("Contractor")?.props.address, params.contractor)
    assert.equal(facts.get("Arbitrator")?.props.address, params.arbitrator)
    const amount = facts.get("Amount to lock in escrow")!
    assert.equal(amount.element === "Status" ? amount.formattedValue : undefined, "0.000001 Native asset (1,000,000,000,000 wei)")
    for (const [label, text] of [["Time to accept", "1 day (86,400 seconds)"], ["Time to complete the work", "7 days (604,800 seconds)"], ["Time to review submitted work", "2 days (172,800 seconds)"], ["Time to resolve a dispute", "3 days (259,200 seconds)"]] as const) {
      const duration = facts.get(label)!
      assert.equal(duration.element === "Status" ? duration.formattedValue : undefined, text)
    }
    assert.equal(facts.get("Recipient if arbitration times out")?.props.value, timeoutRecipient)
    assert.equal(facts.get("Terms document URI")?.props.value, params.terms.uri)
    assert.equal(facts.get("Terms SHA-256 digest")?.props.value, params.terms.sha256Digest)
  }
})
