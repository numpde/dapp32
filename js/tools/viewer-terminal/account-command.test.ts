import assert from "node:assert/strict"
import test from "node:test"

import {
  parseTerminalAccount,
} from "./account-command.ts"

const ACCOUNT = "0x0000000000000000000000000000000000000011"

test("terminal account command accepts one EVM address", () => {
  assert.deepEqual(parseTerminalAccount([ACCOUNT]), {
    kind: "account",
    address: ACCOUNT,
  })
})

test("terminal account command accepts explicit anonymous context", () => {
  assert.deepEqual(parseTerminalAccount(["none"]), { kind: "none" })
})

test("terminal account command rejects missing, extra, and invalid values", () => {
  assert.throws(() => parseTerminalAccount([]), /usage: account/)
  assert.throws(() => parseTerminalAccount([ACCOUNT, "extra"]), /usage: account/)
  assert.throws(() => parseTerminalAccount(["not-an-address"]), /terminal account/)
})
