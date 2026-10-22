import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"

import type { CamViewerLoadedSnapshot, CamViewerPreparedContractCall } from "../../../packages/cam-viewer/dist/index.js"

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
    { element: "Status", props: { label: "Deadline", value: "951782400", format: "timestampSeconds" }, formattedValue: "2000-02-29 00:00:00 UTC (951,782,400 Unix seconds)", children: [] },
    { element: "Status", props: { label: "Absent deadline", value: "0", format: "timestampSeconds", zeroText: "No active deadline" }, formattedValue: "No active deadline", children: [] },
    { element: "Status", props: { label: "Formatted bytes", value: "128" }, formattedValue: "128 bytes", children: [] },
    { element: "Status", props: { label: "Empty presentation", value: "must not replace empty text" }, formattedValue: "", children: [] },
    { element: "Status", props: { label: "Unformatted", value: ["client", "contractor"] }, children: [] },
  ])
  assert.ok(output.includes("Deadline: 2000-02-29 00:00:00 UTC (951,782,400 Unix seconds)\n"))
  assert.ok(output.includes("Absent deadline: No active deadline\n"))
  assert.ok(output.includes("Formatted bytes: 128 bytes\n"))
  assert.ok(output.includes("Empty presentation: \n"))
  assert.ok(output.includes('Unformatted: ["client","contractor"]\n'))
  assert.ok(!output.includes("must not replace empty text"))
})

test("terminal prepared calls show native amounts exactly and omit value when absent", () => {
  const button = { element: "Button" as const, props: { label: "Deposit" }, call: { namespace: "routes", function: "deposit", args: {} } }
  const preparedCall = (value?: CamViewerPreparedContractCall["value"]): CamViewerPreparedContractCall => ({
    route: "deposit",
    address: "0x0000000000000000000000000000000000000001",
    abi: [{ type: "function", name: "deposit", stateMutability: value === undefined ? "nonpayable" : "payable", inputs: [], outputs: [] }],
    function: "deposit",
    args: {},
    then: { namespace: "routes", function: "receipt", args: {} },
    ...(value === undefined ? {} : { value }),
  })

  for (const value of [0, "0", "900719925474099312345"]) {
    const output = statusTerminalOutput([button], undefined, "press 1\nquit\n", false, preparedCall(value))

    assert.ok(output.includes("Contract call requested; no transaction was sent."))
    assert.ok(output.includes(`native amount (wei): ${value}\n`))
  }

  const nonpayable = statusTerminalOutput([button], undefined, "press 1\nquit\n", false, preparedCall())
  assert.ok(nonpayable.includes("Contract call requested; no transaction was sent."))
  assert.ok(!nonpayable.includes("native amount (wei):"))
})

test("terminal human metadata escapes controls and bounds text without changing action JSON", () => {
  const route = "deposit\u001b[2J\nFORGED"
  const uiURI = `https://example.test/cam/${"x".repeat(2_500)}`
  const thenFunction = "receipt\rFORGED"
  const call: CamViewerPreparedContractCall = {
    route,
    address: "0x0000000000000000000000000000000000000001",
    abi: [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }],
    function: "deposit",
    args: {},
    value: "0",
    then: { namespace: "routes", function: thenFunction, args: {} },
  }
  const callButton = { element: "Button" as const, props: { label: "Pay" }, call: { namespace: "routes", function: "deposit", args: {} } }
  const prepared = statusTerminalOutput([callButton], undefined, "press 1\nquit\n", false, call, { route, uiURI })
  assert.ok(prepared.includes(`route: ${formatValue(route)}\n`))
  const uiLine = prepared.split("\n").find(line => line.startsWith("ui: "))
  assert.ok(uiLine !== undefined)
  assert.equal(uiLine, `ui: ${formatValue(uiURI)}`)
  assert.ok(uiLine.length <= "ui: ".length + 2_003)
  assert.ok(prepared.includes("function: deposit\n"))
  assert.ok(prepared.includes(`then: routes.${formatValue(thenFunction)} {}`))
  assert.doesNotMatch(prepared, /[\u0000-\u0009\u000b-\u001f\u007f]/)
  assert.doesNotMatch(prepared, /^FORGED/m)

  const label = `Pay\u001b[2J\nFORGED${"x".repeat(2_500)}`
  const button = {
    element: "Button" as const,
    disabled: true,
    props: { label },
    call: { namespace: "routes", function: "deposit", args: {} },
  }
  const actionsOutput = statusTerminalOutput([button], undefined, "actions\nquit\n")
  assert.ok(actionsOutput.includes(`1. ${formatValue(label)} (disabled)\n`))
  assert.doesNotMatch(actionsOutput, /[\u0000-\u0009\u000b-\u001f\u007f]/)
  assert.doesNotMatch(actionsOutput, /^FORGED/m)
  const actionJsonStart = actionsOutput.lastIndexOf("\n[\n") + 1
  assert.ok(actionJsonStart > 0)
  assert.deepEqual(JSON.parse(actionsOutput.slice(actionJsonStart).trim()), [
    { index: 1, label: `${label} (disabled)`, disabled: true, call: button.call },
  ])
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
  assert.ok(output.includes("Edit with amount amount <base|display> [value]."))
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

test("terminal integer controls preserve lexical text, exact bounds, unavailable states and disabled presence", () => {
  const output = statusTerminalOutput([
    { element: "NonNegativeIntegerField", props: { label: "Counter", min: "1", max: "9007199254740993" },
      state: { key: "counter" }, draft: { text: "00042", status: "valid" }, children: [] },
    { element: "NonNegativeIntegerField", props: { label: "Incomplete counter" },
      state: { key: "pending" }, draft: { text: "42", status: "incomplete", composing: true }, children: [] },
    { element: "NonNegativeIntegerField", props: { label: "Disabled counter" }, disabled: true,
      state: { key: "disabled" }, draft: { text: "42", status: "valid" }, children: [] },
  ])
  assert.ok(output.includes("Counter: 00042\n"))
  assert.ok(output.includes("Minimum: 1\n"))
  assert.ok(output.includes("Maximum: 9007199254740993\n"))
  assert.ok(output.includes("Integer incomplete; no value is available to prepare."))
  assert.ok(output.includes("Disabled counter (disabled): 42\n"))
})

test("terminal duration shows all parts, exact summary and seconds bounds, and edits one named part", () => {
  const output = statusTerminalOutput([
    { element: "DurationField", props: { label: "Wait", min: "1", max: "86400" }, state: { key: "wait" },
      draft: { parts: { days: { text: "", status: "empty" }, hours: { text: "", status: "empty" }, minutes: { text: "0002", status: "valid" }, seconds: { text: "90", status: "valid" } }, status: "valid" },
      formattedValue: "3 minutes, 30 seconds (210 seconds)", children: [] },
  ], undefined, "duration wait minutes 0002\nduration wait seconds\nduration wait weeks 2\nquit\n")
  assert.ok(output.includes("minutes: 0002"))
  assert.ok(output.includes("Total: 3 minutes, 30 seconds (210 seconds)"))
  assert.ok(output.includes("Minimum seconds: 1"))
  assert.ok(output.includes("Maximum seconds: 86400"))
  assert.ok(output.includes('DURATION_EDIT ["wait","minutes","0002"]'))
  assert.ok(output.includes('DURATION_EDIT ["wait","seconds",""]'))
  assert.ok(output.includes("usage: duration"))
})

test("terminal duration commands edit a real viewer session without normalizing its part drafts", () => {
  const backend = new URL("../backends/index.ts", import.meta.url)
  const terminal = new URL("../terminal-session.ts", import.meta.url)
  const viewer = new URL("../../../packages/cam-viewer/dist/index.js", import.meta.url)
  const fixtures = new URL("../../../../tests/fixtures/cam/", import.meta.url)
  const script = `
    import { mock } from 'node:test';
    import { createHash } from 'node:crypto';
    import { createCamViewerSession } from ${JSON.stringify(viewer.href)};
    import { bikeResourceBytes, createMockCamPublicClient, createMockResourceLoader, encodeJson } from ${JSON.stringify(new URL("mock.mts", fixtures).href)};
    import { BIKE_CAM_URI, BIKE_UI_URI, BIKE_ACCOUNT_ADDRESS, BIKE_SERIAL_NUMBER, bikeHost, bikeContractAddresses, bikeRouteResults } from ${JSON.stringify(new URL("bike.mts", fixtures).href)};
    const digest = bytes => '0x'+createHash('sha256').update(bytes).digest('hex');
    const resources = bikeResourceBytes({});
    const uiBytes = encodeJson({ui:'1.0.0',nodes:{app:{requires:['view'],element:'DurationField',props:{label:'Wait',min:'1',max:'86400'},state:{key:'wait',defaultValue:''}}}});
    const cam = JSON.parse(new TextDecoder().decode(resources[BIKE_CAM_URI]));
    cam.namespaces.ui.integrity = 'sha256:0x'+createHash('sha256').update(uiBytes).digest('hex');
    const camBytes = encodeJson(cam);
    const session = createCamViewerSession({host:bikeHost, account:{address:BIKE_ACCOUNT_ADDRESS}, inputs:{},
      publicClient:createMockCamPublicClient({chainId:31337,camURI:BIKE_CAM_URI,camHash:digest(camBytes),supportsCamInterface:true,addresses:bikeContractAddresses,routeResults:bikeRouteResults(BIKE_SERIAL_NUMBER,BIKE_ACCOUNT_ADDRESS,'active')}),
      loadResource:createMockResourceLoader(bikeResourceBytes({[BIKE_CAM_URI]:camBytes,[BIKE_UI_URI]:uiBytes}))});
    mock.module(${JSON.stringify(backend.href)}, {namedExports:{createTerminalBackendFromEnv:async()=>({name:'duration-fixture',description:'duration input',hostLabel:'fixture',createSession:()=>session})}});
    await import(${JSON.stringify(terminal.href)});
  `
  const output = execFileSync(process.execPath, ["--experimental-test-module-mocks", "--experimental-strip-types", "--input-type=module", "-e", script], {
    input: "duration wait minutes 90\nduration wait seconds 1.5\nquit\n", encoding: "utf8", timeout: 10_000, maxBuffer: 512_000,
  })
  assert.ok(output.includes("minutes: 90"))
  assert.ok(output.includes("Total: 1 hour, 30 minutes (5,400 seconds)"))
  assert.ok(output.includes("seconds: 1.5"))
  assert.ok(output.includes("Duration invalid; no duration is available."))
})

test("terminal integer commands preserve raw text and forward explicit clearing through the session API", () => {
  const output = statusTerminalOutput([], undefined, "integer counter 00042\ninteger counter 9007199254740993\ninteger counter 1.5\ninteger counter\nquit\n")
  for (const value of ["00042", "9007199254740993", "1.5", ""]) assert.ok(output.includes("INTEGER_EDIT " + JSON.stringify(["counter", value]) + "\n"))
})

test("terminal integer labels and rejected lexical text cannot inject terminal controls", () => {
  const output = statusTerminalOutput([
    { element: "NonNegativeIntegerField", props: { label: "Counter\u001b[2J\nFORGED" }, state: { key: "counter" },
      draft: { text: "1\u001b[2J", status: "invalid", issue: "syntax" }, children: [] },
  ])
  assert.ok(output.includes("Counter\\u001b[2J\\u000aFORGED: 1\\u001b[2J"))
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

test("terminal error rendering retains string causes without credentials or terminal controls", () => {
  const visible = formatError(new Error("outer operation failed", { cause: "network disconnected\nhttps://example.test/rpc?token=fixture-string-token" }))
  assert.match(visible, /network disconnected/)
  assert.match(visible, /example.test\/rpc/)
  assert.doesNotMatch(visible, /fixture-string-token|\u001b/)
  assert.equal(visible.split("\n").length, 2, "only the terminal-owned line ending is emitted")
})

test("terminal press retains the route rejection and meaningful custom revert once", () => {
  const output = statusTerminalOutput([
    { element: "Button", props: { label: "Open resource" }, call: { namespace: "routes", function: "open", args: {} } },
  ], undefined, "press 1\nquit\n", true)
  assert.match(output, /failed to call CAM route: open/)
  assert.match(output, /ChannelNotFound\(999999\)/)
  assert.equal(output.split("ChannelNotFound(999999)").length - 1, 1)
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
  assert.match(formatError(hostile), /^Error: .*unprintable.*\n$/)
})

test("formatError keeps blank thrown values visibly diagnostic", () => {
  assert.equal(formatError(""), "Error: The error did not include a readable message.\n")
  assert.equal(formatError("   "), "Error: The error did not include a readable message.\n")
  assert.equal(formatError("\n"), "Error: \\u000a\n")
})

function statusTerminalOutput(
  children: CamViewerLoadedSnapshot["resolvedUi"][],
  title?: string,
  commands?: string,
  rejectAction?: boolean,
  preparedCall?: CamViewerPreparedContractCall,
  snapshotOverrides?: Partial<Pick<CamViewerLoadedSnapshot, "route" | "uiURI" | "state">>,
): string {
  const snapshot: CamViewerLoadedSnapshot = {
    canGoBack: false, route: "entry", inputs: {}, state: {}, values: [], uiURI: "fixture://status-display",
    ...snapshotOverrides,
    documentHashes: {},
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
    const preparedCall = ${JSON.stringify(preparedCall)};
    const dispatchAction = ${rejectAction === true} ? async () => {
      throw new Error('failed to call CAM route: open', { cause: { data: { errorName: 'ChannelNotFound', args: [999999n] } } });
    } : preparedCall === undefined ? unsupported : async () => ({ type: 'contractCall', call: preparedCall });
    mock.module(${JSON.stringify(backend.href)}, { namedExports: {
      createTerminalBackendFromEnv: async () => ({
        name: 'display-fixture', description: 'resolved Status display', hostLabel: 'fixture',
        createSession: () => ({ snapshot: () => snapshot, load: async () => snapshot,
          back: unsupported, navigate: unsupported, setAccount: unsupported,
          updateState: unsupported, dispatchAction,
          editAmount: (name, representation, text) => { process.stdout.write('AMOUNT_EDIT '+JSON.stringify([name,representation,text])+'\\n'); return snapshot; },
          editDuration: (name, part, text) => { process.stdout.write('DURATION_EDIT '+JSON.stringify([name,part,text])+'\\n'); return snapshot; },
          editInteger: (name, text) => { process.stdout.write('INTEGER_EDIT '+JSON.stringify([name,text])+'\\n'); return snapshot; } })
      })
    }});
    await import(${JSON.stringify(terminal.href)});
  `
  return execFileSync(process.execPath, [
    "--experimental-test-module-mocks", "--experimental-strip-types", "--input-type=module", "-e", script,
  ], { input: commands === undefined ? "quit\n" : commands, encoding: "utf8", timeout: 10_000, maxBuffer: 512_000 })
}


test("terminal renders NFT metadata URI fields without treating local preparation as published", () => {
  const output = statusTerminalOutput([
    { element: "NftMetadataField", props: { label: "Token metadata" }, state: { key: "tokenURI" }, children: [] },
    { element: "NftMetadataField", props: { label: "Disabled metadata" }, state: { key: "locked" }, disabled: true, children: [] },
    { element: "Nft", props: { contractAddress: "0x0000000000000000000000000000000000000001", tokenId: "7", metadataURI: "https://example.test/token.json" }, children: [] },
  ], undefined, undefined, undefined, undefined, { state: { tokenURI: "https://example.test/token.json", locked: "https://example.test/locked.json" } })
  assert.ok(output.includes("Token metadata: https://example.test/token.json"))
  assert.ok(output.includes("Disabled metadata (disabled): https://example.test/locked.json"))
  assert.ok(output.includes("Metadata URI: https://example.test/token.json"))
})
