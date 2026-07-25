import assert from "node:assert/strict"
import test from "node:test"

import {
  renderToStaticMarkup,
} from "react-dom/server"

import {
  PreparedCallView,
} from "../src/components.tsx"
import { formatInertValue } from "../src/display.ts"

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
  const markup = renderToStaticMarkup(PreparedCallView({
    call: {
      ...preparedCall,
      value: "1000000000000000000",
    },
    canSend: true,
    sending: false,
    async onSend() {},
  }))

  assert.match(markup, /Value \(wei\)/)
  assert.match(markup, /1000000000000000000/)
})

test("value-free prepared calls do not invent a transaction amount", () => {
  const markup = renderToStaticMarkup(PreparedCallView({
    call: preparedCall,
    canSend: true,
    sending: false,
    async onSend() {},
  }))

  assert.doesNotMatch(markup, /Value \(wei\)/)
})
