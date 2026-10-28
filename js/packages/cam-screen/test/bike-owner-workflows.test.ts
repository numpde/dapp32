import assert from "node:assert/strict"
import test from "node:test"
import { parseJsonBytes, toInertValue } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import { parseUi, resolveInitialUiNode, resolveUiNode, resolvedUiButtons, forEachResolvedUiNode } from "../src/index.ts"
import type { ResolvedUiNode, UiRuntimeContext } from "../src/index.ts"
import { bikeUiBytes } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { BIKE_ACCOUNT_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_SERIAL_NUMBER, BIKE_TOKEN_ID, bikeHost, bikeEntryRouteResult, bikeComponentRouteResult, bikeRegisterRouteResult } from "../../../../tests/fixtures/cam/bike.mts"
import { BUYER, WORKSHOP, OTHER_WORKSHOP, PREVIEW_EXPIRY, ownerComponentView, workshopView } from "../../../../tests/fixtures/cam/bike-owner-workflows.mts"

const context: UiRuntimeContext = { host: bikeHost, account: { address: BIKE_ACCOUNT_ADDRESS }, inputs: {}, outputs: [], state: {} }
const ui = () => parseUi(parseJsonBytes(bikeUiBytes))
function args(view: Record<string, unknown>): InertRecord {
  const normalized = Object.fromEntries(Object.entries(view).map(([name, value]) => [
    name, typeof value === "bigint" ? value.toString() : value,
  ]))
  return { view: toInertValue({ screen: normalized.viewId, task: normalized }) }
}
const render = (view: Record<string, unknown>) => resolveInitialUiNode(ui(), "app", args(view), context)

test("every Bike task exposes the same input-independent app destinations", () => {
  const authority = { target: BIKE_COMPONENTS_ADDRESS, current: BIKE_ACCOUNT_ADDRESS, pending: BUYER, readyAt: "0", status: "Pending" }
  const screens = [
    render(bikeEntryRouteResult(BIKE_ACCOUNT_ADDRESS)),
    ...["", "UNKNOWN", BIKE_SERIAL_NUMBER].map(serial => render(bikeComponentRouteResult(serial, BIKE_ACCOUNT_ADDRESS, "active"))),
    ...["", "UNKNOWN", BIKE_SERIAL_NUMBER].map(serial => render(bikeRegisterRouteResult(serial, BIKE_ACCOUNT_ADDRESS))),
    render(workshopView()),
    resolveInitialUiNode(ui(), "app", { view: toInertValue({ screen: "deploymentHandovers", task: {
      paused: false, componentTokenPaused: false, cam: authority, components: authority, manager: authority, actions: [],
    } }) }, context),
  ]
  for (const screen of screens) {
    const groups: ResolvedUiNode[] = []
    forEachResolvedUiNode(screen.resolvedUi, node => { if (node.element === "Screen" && node.props.title === "App navigation") groups.push(node) })
    assert.equal(groups.length, 1, "each task has one navigation group")
    assert.deepEqual(resolvedUiButtons(groups[0]!).map(button => ({ label: button.props.label, route: button.call.function, args: { ...button.call.args }, enabled: button.disabled !== true })), [
      { label: "Find a component", route: "entry", args: {}, enabled: true },
      { label: "Register a component", route: "register", args: { serialNumber: "" }, enabled: true },
      { label: "Deployment handovers", route: "deploymentHandovers", args: {}, enabled: true },
    ])
  }
  assert.deepEqual(button(render(workshopView()).resolvedUi, "component").call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER }), "returning to the loaded component remains contextual")
})

function button(node: ResolvedUiNode, route: string) {
  const found = resolvedUiButtons(node).find(candidate => candidate.call.function === route)
  assert.ok(found, `Bike publication must expose ${route}`)
  return found
}
function field(node: ResolvedUiNode, key: string) {
  let found: ResolvedUiNode | undefined
  forEachResolvedUiNode(node, candidate => { if ("state" in candidate && candidate.state.key === key) found = candidate })
  assert.ok(found, `Bike publication must expose ${key} input`)
  return found
}

test("NFT document editing has a task subsection and keeps each commit at its owning scope", () => {
  for (const [view, title, action] of [
    [bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, BIKE_ACCOUNT_ADDRESS), "NFT details", "registerComponent"],
    [ownerComponentView(), "Edit NFT details", "updateComponentMetadata"],
  ] as const) {
    const initial = render(view)
    const sections: ResolvedUiNode[] = []
    forEachResolvedUiNode(initial.resolvedUi, node => {
      if (node.element === "Screen" && node.props.title === title) sections.push(node)
    })
    assert.equal(sections.length, 1)
    const metadata = sections[0]!
    const originalEditor = field(metadata, "tokenURI")
    assert.ok(originalEditor.element === "NftMetadataField")
    assert.equal(originalEditor.props.label, "Metadata document")
    assert.deepEqual(resolvedUiButtons(metadata).map(node => node.call.function),
      action === "registerComponent" ? [] : [action],
      "registration commits the whole form; metadata updates belong beside the editor")
    const uri = "https://example.test/component.json"
    const edited = resolveUiNode(ui(), "app", args(view), { ...context, state: { ...initial.state, tokenURI: uri } })
    assert.equal(button(edited, action).call.args.tokenURI, uri)
    const editedEditor = field(edited, "tokenURI")
    assert.ok(editedEditor.element === "NftMetadataField")
    assert.equal(editedEditor.disabled, originalEditor.disabled)
  }
})

test("owner opens a specific workshop lookup without replacing the loaded component", () => {
  const view = ownerComponentView()
  const initial = render(view)
  field(initial.resolvedUi, "delegate")
  const resolved = resolveUiNode(ui(), "app", args(view), { ...context, state: { ...initial.state, delegate: OTHER_WORKSHOP, serialNumber: "OTHER-SERIAL" } })
  const lookup = button(resolved, "delegation")
  assert.equal(lookup.call.args.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(lookup.call.args.delegate, OTHER_WORKSHOP)
})

test("a short workshop cap requires an explicit duration and bounds the first preview", () => {
  const view = ownerComponentView({ maxDelegationDuration: 1800n })
  const initial = render(view)
  const duration = field(initial.resolvedUi, "duration")
  assert.ok(duration.element === "DurationField")
  assert.equal(initial.state.duration, null, "the owner must choose a duration")
  assert.equal(button(initial.resolvedUi, "delegation").call.args.duration, null)
  assert.equal(duration.props.min, "1")
  assert.equal(duration.props.max, "1800", "the first form uses the configured cap")

  const selected = resolveUiNode(ui(), "app", args(view), {
    ...context, state: { ...initial.state, delegate: WORKSHOP, duration: "1800" },
  })
  assert.equal(button(selected, "delegation").call.args.duration, "1800")
  const tooLong = resolveUiNode(ui(), "app", args(view), {
    ...context, state: { ...initial.state, delegate: WORKSHOP, duration: "1801" },
  })
  const rejected = field(tooLong, "duration")
  assert.ok(rejected.element === "DurationField")
  assert.equal(rejected.draft.issue, "aboveMax")
})

test("workshop permissions are named bounded presets, never raw masks or retirement", () => {
  const { resolvedUi } = render(workshopView())
  const grants = resolvedUiButtons(resolvedUi).filter(candidate => candidate.call.function === "setComponentDelegate")
  assert.equal(grants.length, 4, "metadata, report, resolve and combined workshop presets")
  for (const [mask, label] of [["1", /metadata/i], ["2", /report.*missing/i], ["4", /resolve.*missing/i], ["7", /all.*workshop/i]] as const) {
    const grant = grants.find(candidate => candidate.call.args.capabilities === mask)
    assert.ok(grant, `missing named workshop preset ${mask}`)
    assert.match(String(grant.props.label), label)
    assert.deepEqual(grant.call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, delegate: WORKSHOP, capabilities: mask, validUntil: PREVIEW_EXPIRY }))
  }
  forEachResolvedUiNode(resolvedUi, node => {
    if ("state" in node) assert.ok(!["capabilities", "validUntil"].includes(node.state.key), "no raw bitmask or Unix-expiry input")
  })
  let replacementExplained = false
  forEachResolvedUiNode(resolvedUi, node => {
    if (node.element === "Text" && /replace.*permissions.*expiry/i.test(String(node.props.text))) replacementExplained = true
  })
  assert.ok(replacementExplained, "setting a preset replaces the existing permissions and expiry")
})

test("workshop duration is human-readable and previews an exact onchain expiry", () => {
  const { resolvedUi } = render(workshopView())
  const duration = field(resolvedUi, "duration")
  assert.ok(duration.element === "DurationField")
  assert.equal(duration.props.min, "1")
  assert.equal(duration.props.max, "2592000")
  assert.equal(button(resolvedUi, "delegation").call.args.duration, "3600")
  let shownExpiry = false
  forEachResolvedUiNode(resolvedUi, node => { if (node.element === "Status" && node.props.value === PREVIEW_EXPIRY) shownExpiry = true })
  assert.ok(shownExpiry, "show the exact previewed expiry before granting")
})

test("revocation targets the inspected workshop, not an edited lookup address", () => {
  const view = workshopView()
  const initial = render(view)
  const resolved = resolveUiNode(ui(), "app", args(view), { ...context, state: { ...initial.state, delegate: OTHER_WORKSHOP } })
  assert.deepEqual(button(resolved, "revokeComponentDelegate").call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, delegate: WORKSHOP }))
  assert.equal(button(resolved, "delegation").call.args.delegate, OTHER_WORKSHOP)
})

test("inspecting another workshop discloses its grant and does not grant the viewer owner controls", () => {
  const { resolvedUi } = render(workshopView({ account: BUYER, isOwner: false, authorityId: "none", actions: ["lookupComponent", "delegation"] }))
  const shown = new Map<string, unknown>()
  forEachResolvedUiNode(resolvedUi, node => {
    if (node.element === "Address") shown.set(String(node.props.label), node.props.address)
    if (node.element === "Status") shown.set(String(node.props.label), node.props.value)
  })
  assert.equal(shown.get("Workshop"), WORKSHOP)
  assert.equal(shown.get("Delegation grantor"), BIKE_ACCOUNT_ADDRESS)
  assert.equal(shown.get("Delegation capabilities"), "1")
  assert.equal(shown.get("Delegation expiry (Unix seconds)"), PREVIEW_EXPIRY)
  assert.equal(shown.get("Delegation active"), true)
  const grants = resolvedUiButtons(resolvedUi).filter(candidate => candidate.call.function === "setComponentDelegate")
  assert.equal(grants.length, 4)
  assert.ok(grants.every(candidate => candidate.disabled === true))
  assert.equal(button(resolvedUi, "revokeComponentDelegate").disabled, true)
  assert.notEqual(button(resolvedUi, "delegation").disabled, true)
})

for (const inactive of [false, true]) {
 for (const missing of [false, true]) {
  test(`guided handover discloses record NFT and both flags: inactive=${inactive}, missing=${missing}`, () => {
    const statusId = missing ? "missing" : "active"
    const view = ownerComponentView({ inactive, statusId, viewId: inactive ? "component.inactive" : `component.${statusId}` })
    const initial = render(view)
    field(initial.resolvedUi, "to")
    const resolved = resolveUiNode(ui(), "app", args(view), { ...context, state: { ...initial.state, to: BUYER, serialNumber: "OTHER-SERIAL" } })
    const transfer = button(resolved, "transferComponent")
    assert.notEqual(transfer.disabled, true)
    assert.deepEqual(transfer.call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, to: BUYER }))
    const nfts: { contractAddress: unknown; tokenId: unknown }[] = []
    const statuses: unknown[] = []
    forEachResolvedUiNode(resolved, node => {
      if (node.element === "Nft") nfts.push({ contractAddress: node.props.contractAddress, tokenId: node.props.tokenId })
      if (node.element === "Status") statuses.push(node.props.value)
    })
    assert.ok(nfts.some(node => node.contractAddress === BIKE_COMPONENTS_ADDRESS && node.tokenId === String(BIKE_TOKEN_ID)))
    assert.ok(statuses.includes(statusId), "handover must disclose registry status, not imply a clean/active bike")
    const displayed = new Map<string, unknown>()
    forEachResolvedUiNode(resolved, node => { if (node.element === "Status") displayed.set(String(node.props.label), node.props.value) })
    assert.equal(displayed.get("Out of service"), inactive, "lifecycle disclosure is independent of missing report")
  })
 }
}

test("handover becomes unavailable when its record token is paused or viewer is not owner", () => {
  for (const changes of [{ componentTokenPaused: true }, { isOwner: false, authorityId: "delegate" }]) {
    const { resolvedUi } = render(ownerComponentView({ ...changes, canTransfer: false, actions: ["lookupComponent", "delegation"] }))
    assert.equal(button(resolvedUi, "transferComponent").disabled, true)
  }
})
