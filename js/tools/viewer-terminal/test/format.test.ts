import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

import type { CamViewerLoadedSnapshot } from "../../../packages/cam-viewer/dist/index.js"

import { formatDisplayText, formatError, formatValue } from "../format.ts"

test("formatValue bounds human terminal display text", () => {
  const long = "x".repeat(2_500)

  assert.equal(formatValue(long), `${"x".repeat(2_000)}...`)
  assert.equal(formatValue({ text: long }), `${JSON.stringify({ text: long }).slice(0, 2_000)}...`)
  assert.equal(formatValue(BigInt(`1${"0".repeat(2_500)}`)), `${`1${"0".repeat(2_500)}`.slice(0, 2_000)}...`)
  assert.equal(formatDisplayText(long), `${"x".repeat(2_000)}...`)
})

test("terminal display escapes C0/DEL before enforcing its output bound", () => {
  const controls = "\u001b[2J\r\n\t\u0000\u007f"
  assert.equal(formatDisplayText(controls), "\\u001b[2J\\u000d\\u000a\\u0009\\u0000\\u007f")
  const long = formatValue("\u001b".repeat(2_500))
  assert.ok(long.length <= 2_003)
  assert.ok(long.endsWith("..."))
  assert.doesNotMatch(long, /[\u0000-\u001f\u007f]/)
})

test("terminal output consumes resolved Status presentation and preserves unformatted values", () => {
  const output = statusTerminalOutput([
    { element: "Status", props: { label: "Formatted bytes", value: "128" }, formattedValue: "128 bytes", children: [] },
    { element: "Status", props: { label: "Empty presentation", value: "must not replace empty text" }, formattedValue: "", children: [] },
    { element: "Status", props: { label: "Unformatted", value: ["client", "contractor"] }, children: [] },
  ])
  assert.ok(output.includes("Formatted bytes: 128 bytes\n"))
  assert.ok(output.includes("Empty presentation: \n"))
  assert.ok(output.includes('Unformatted: ["client","contractor"]\n'))
  assert.ok(!output.includes("must not replace empty text"))
})

test("formatted Status list text escapes C0/DEL and cannot forge output lines", () => {
  const value = "client\u001b[2J, contractor\rINJECTED\nFORGED\u0000"
  const output = statusTerminalOutput([
    { element: "Status", props: { label: "Choices", value: [value] }, formattedValue: value, children: [] },
  ])
  assert.ok(output.includes("Choices: client\\u001b[2J, contractor\\u000dINJECTED\\u000aFORGED\\u0000\n"))
  assert.doesNotMatch(output, /[\u0000-\u0008\u000b-\u001f\u007f]/)
  assert.doesNotMatch(output, /^FORGED/m)
})

test("terminal Screen titles share the bounded untrusted text boundary", () => {
  const output = statusTerminalOutput([], "Notice\u001b[2J\r\nFORGED")
  assert.ok(output.includes("\nNotice\\u001b[2J\\u000d\\u000aFORGED\n"))
  assert.doesNotMatch(output, /[\u0000-\u0008\u000b-\u001f\u007f]/)
  assert.doesNotMatch(output, /^FORGED/m)
  const longOutput = statusTerminalOutput([], `Title${"\u001b".repeat(2_500)}`)
  const titleLine = longOutput.split("\n").find((line) => line.startsWith("Title"))
  assert.ok(titleLine !== undefined && titleLine.length <= 2_003 && titleLine.endsWith("..."))
  assert.doesNotMatch(titleLine, /[\u0000-\u001f\u007f]/)
})

test("formatValue survives unprintable terminal values", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const hostileJson = {
    toJSON() {
      throw new Error("json failed")
    },
  }
  const hostileFallback = {
    toJSON() {
      return undefined
    },
    toString() {
      throw new Error("stringification failed")
    },
  }

  assert.equal(formatValue(cyclic), "[unprintable value]")
  assert.equal(formatValue(hostileJson), "[unprintable value]")
  assert.equal(formatValue(hostileFallback), "[unprintable value]")
  assert.equal(formatValue(undefined), "undefined")
})

test("formatError survives hostile thrown values", () => {
  const hostile = {
    toJSON() {
      return undefined
    },
    toString() {
      throw new Error("stringification failed")
    },
  }

  assert.equal(formatError(new Error("failed")), "Error: failed\n")
  assert.equal(formatError(hostile), "Error: [unprintable value]\n")
})

function statusTerminalOutput(children: CamViewerLoadedSnapshot["resolvedUi"][], title?: string): string {
  const snapshot: CamViewerLoadedSnapshot = {
    canGoBack: false, route: "entry", inputs: {}, state: {}, values: [], uiURI: "fixture://status-display",
    resolvedUi: title === undefined
      ? { element: "Fragment", props: {}, children }
      : { element: "Screen", props: { title }, children },
  }
  const backend = new URL("../backends/index.ts", import.meta.url)
  const terminal = new URL("../terminal-session.ts", import.meta.url)
  const script = `
    import { mock } from 'node:test';
    const snapshot = ${JSON.stringify(snapshot)};
    const unsupported = () => { throw new Error('The display fixture supports load and snapshot only'); };
    mock.module(${JSON.stringify(backend.href)}, { namedExports: {
      createTerminalBackendFromEnv: async () => ({
        name: 'display-fixture', description: 'resolved Status display', hostLabel: 'fixture',
        createSession: () => ({ snapshot: () => snapshot, load: async () => snapshot,
          back: unsupported, navigate: unsupported, setAccount: unsupported,
          updateState: unsupported, dispatchAction: unsupported })
      })
    }});
    await import(${JSON.stringify(terminal.href)});
  `
  return execFileSync(process.execPath, [
    "--experimental-test-module-mocks", "--experimental-strip-types", "--input-type=module", "-e", script,
  ], { input: "quit\n", encoding: "utf8", timeout: 10_000, maxBuffer: 512_000 })
}
