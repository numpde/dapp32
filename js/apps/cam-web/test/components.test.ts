import assert from "node:assert/strict"
import test from "node:test"

import { formatInertValue } from "../src/display.ts"
import {
  preparedCallFields,
} from "../src/prepared-call.ts"

const preparedCall = {
  route: "fund",
  address: "0x0000000000000000000000000000000000000001" as const,
  abi: [],
  function: "fund",
  args: {},
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
  assert.equal(fields.find(field => field.label === "Function inputs")?.value, formatInertValue({ channelId: "2" }))
})

test("value-free prepared calls do not invent a transaction amount", () => {
  assert.equal(
    preparedCallFields(preparedCall).some((field) => field.label === "Native amount to send (wei)"),
    false,
  )
})
