import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

import {
  validateCamBundle,
} from "../src/index.ts"

const ESCROW_CAM_DIRECTORY = new URL("../../../../dapps/escrow/cam/", import.meta.url)
const ESCROW_CAM_URI = "https://example.test/escrow/cam/main.json"

const AGREEMENT_TRANSITIONS = [
  "cancelAgreement",
  "acceptAgreement",
  "submitAgreement",
  "approveAgreement",
  "disputeAgreement",
  "finalizeAcceptanceTimeout",
  "finalizeWorkTimeout",
  "finalizeReviewTimeout",
  "resolveForClient",
  "resolveForContractor",
  "finalizeArbitrationTimeout",
] as const

test("checked-in escrow CAM 1.1 bundle conforms", async () => {
  const bundle = await escrowBundle()
  assert.deepEqual(validateCamBundle(bundle), [])
})

test("escrow CAM routes preserve the machine and native-value boundaries", async () => {
  const rootBytes = new Uint8Array(await readFile(new URL("main.json", ESCROW_CAM_DIRECTORY)))
  const root = requiredRecord(parseJsonBytes(rootBytes), "root")
  assert.equal(root.cam, "1.1.0")
  assert.equal(root.entry, "createAgreementForm")

  const namespaces = requiredRecord(root.namespaces, "namespaces")
  assert.equal(
    Object.values(namespaces).some((declaration) =>
      isRecordObject(declaration) && declaration.type === "machine"
    ),
    false,
  )

  const routes = requiredRecord(root.routes, "routes")
  const create = requiredRecord(routes.createAgreement, "routes.createAgreement")
  assert.deepEqual(create.inputs, ["params"])
  assert.equal(create.value, "$inputs.params.amount")
  assert.deepEqual(requiredRecord(create.call, "routes.createAgreement.call").args, {
    params: "$inputs.params",
  })
  assert.deepEqual(requiredRecord(create.then, "routes.createAgreement.then"), {
    namespace: "routes",
    function: "lookupAgreement",
    args: {
      client: "$account.address",
      agreementRef: "$inputs.params.agreementRef",
    },
  })

  for (const transition of AGREEMENT_TRANSITIONS) {
    const route = requiredRecord(routes[transition], `routes.${transition}`)
    assert.equal(route.kind, "write", transition)
    assert.equal(requiredRecord(route.call, `routes.${transition}.call`).function, transition)
    assert.equal(requiredRecord(route.then, `routes.${transition}.then`).function, "agreement")
  }

  const withdrawal = requiredRecord(routes.withdrawTo, "routes.withdrawTo")
  assert.equal(requiredRecord(withdrawal.then, "routes.withdrawTo.then").function, "accountCredit")
})

async function escrowBundle() {
  const rootBytes = new Uint8Array(await readFile(new URL("main.json", ESCROW_CAM_DIRECTORY)))
  const root = requiredRecord(parseJsonBytes(rootBytes), "root")
  const namespaces = requiredRecord(root.namespaces, "namespaces")
  const resources = new Map<string, Uint8Array>()

  for (const declarationValue of Object.values(namespaces)) {
    if (!isRecordObject(declarationValue)) continue

    const uri = resourceUri(declarationValue)
    if (uri === undefined) continue
    resources.set(uri, new Uint8Array(await readFile(new URL(uri, ESCROW_CAM_DIRECTORY))))
  }

  return {
    rootURI: ESCROW_CAM_URI,
    rootBytes,
    resources,
  }
}

function resourceUri(declaration: Record<string, unknown>): string | undefined {
  if (typeof declaration.abiURI === "string") return declaration.abiURI
  if (typeof declaration.uri === "string") return declaration.uri
  return undefined
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  assert.equal(isRecordObject(value), true, `${label} must be an object`)
  return value as Record<string, unknown>
}
