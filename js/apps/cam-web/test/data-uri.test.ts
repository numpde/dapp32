import assert from "node:assert/strict"
import test from "node:test"
import { readDataURI, readTextDataURI, textDataURI } from "../src/data-uri.ts"

test("embedded text and JSON round-trip exact UTF-8 bytes", () => {
  for (const [type, text] of [["text/plain", "Hello 🚲\r\nworld"], ["application/json", '{ "serial": 9007199254740993 }']] as const) {
    const uri = textDataURI(text, type, 1024)
    assert.equal(readTextDataURI(uri, 1024).text, text)
    assert.equal(readTextDataURI(uri, 1024).type, type)
  }
  assert.equal(readTextDataURI("data:text/plain;base64,SGVsbG8=", 5).text, "Hello")
  assert.equal(readTextDataURI("data:text/plain,Hello", 5).text, "Hello")
})

test("embedded documents reject malformed input without changing it", () => {
  assert.throws(() => textDataURI("{", "application/json", 10), /JSON syntax/)
  assert.throws(() => textDataURI("\ud800", "text/plain", 10), /Unicode/)
  assert.throws(() => textDataURI("🚲", "text/plain", 3), /too large/)
  assert.throws(() => readDataURI("data:text/plain,%zz", 10), /malformed/)
  assert.throws(() => readTextDataURI("data:text/html,Hello", 10), /only plain text and JSON/)
  assert.throws(() => readTextDataURI("data:text/plain;base64,/w==", 10), /UTF-8/)
})
