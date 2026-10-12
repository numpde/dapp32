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

test("terminal amount controls retain paired exact units, unavailable drafts and disabled presence", () => {
  const unit = { assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18 }
  const output = statusTerminalOutput([
    { element: "AmountField", props: { label: "Deposit" }, unit, state: { key: "amount" },
      draft: { representation: "display", baseText: "10000000000000000", displayText: "0.0100", status: "valid" }, children: [] },
    { element: "AmountField", props: { label: "Incomplete deposit" }, unit, state: { key: "incomplete" },
      draft: { representation: "display", baseText: "", displayText: ".", status: "incomplete" }, children: [] },
    { element: "AmountField", props: { label: "Disabled deposit" }, unit, state: { key: "disabled" }, disabled: true,
      draft: { representation: "base", baseText: "0", displayText: "0", status: "valid" }, children: [] },
  ])
  assert.ok(output.includes("Deposit\n  wei: 10000000000000000\n  ETH: 0.0100\n"))
  assert.ok(output.includes("Units declared by this application"))
  assert.ok(output.includes("Incomplete deposit\n  wei: \n  ETH: .\n"))
  assert.ok(output.includes("Amount incomplete; no amount is available to prepare."))
  assert.ok(output.includes("Disabled deposit (disabled)\n  wei: 0\n  ETH: 0\n"))
})

test("terminal amount commands preserve lexical input and route editing through the session API", () => {
  const output = statusTerminalOutput([], undefined,
    "amount deposit display 0.0100\namount deposit base 9007199254740993\namount deposit display\nquit\n")
  assert.ok(output.includes('AMOUNT_EDIT ["deposit","display","0.0100"]\n'))
  assert.ok(output.includes('AMOUNT_EDIT ["deposit","base","9007199254740993"]\n'))
  assert.ok(output.includes('AMOUNT_EDIT ["deposit","display",""]\n'))
})

test("terminal amount unit labels pass through the untrusted text boundary", () => {
  const output = statusTerminalOutput([
    { element: "AmountField", props: { label: "Deposit" }, state: { key: "amount" },
      unit: { assetId: "$asset", baseLabel: "wei\u001b[2J", displayLabel: "$\nFORGED", decimals: 6 },
      draft: { representation: "base", baseText: "1", displayText: "0.000001", status: "valid" }, children: [] },
  ])
  assert.ok(output.includes("wei\\u001b[2J: 1"))
  assert.ok(output.includes("$\\u000aFORGED: 0.000001"))
  assert.doesNotMatch(output, /[\u0000-\u0008\u000b-\u001f\u007f]/)
  assert.doesNotMatch(output, /^FORGED/m)
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

function statusTerminalOutput(children: CamViewerLoadedSnapshot["resolvedUi"][], title?: string, commands?: string): string {
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
          updateState: unsupported, dispatchAction: unsupported,
          editAmount: (name, representation, text) => { process.stdout.write('AMOUNT_EDIT '+JSON.stringify([name,representation,text])+'\\n'); return snapshot; } })
      })
    }});
    await import(${JSON.stringify(terminal.href)});
  `
  return execFileSync(process.execPath, [
    "--experimental-test-module-mocks", "--experimental-strip-types", "--input-type=module", "-e", script,
  ], { input: commands === undefined ? "quit\n" : commands, encoding: "utf8", timeout: 10_000, maxBuffer: 512_000 })
}
