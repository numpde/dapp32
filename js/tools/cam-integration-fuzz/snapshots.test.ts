import assert from "node:assert/strict"
import test from "node:test"

import type { CamViewerSnapshot } from "../../packages/cam-viewer/dist/index.js"
import { assertResolvedSnapshot, requireLoadedSnapshot } from "./snapshots.ts"

test("loaded snapshots preserve all required fields and the full integrity history", () => {
  const verified = {
    hashSource: "contract" as const,
    status: "verified" as const,
    uri: "https://example.test/main.json",
    expectedHash: "0x1234",
    actualHash: "0x1234",
  }
  const mismatch = {
    hashSource: "manifest" as const,
    status: "mismatch" as const,
    uri: "https://example.test/ui.json",
    expectedHash: "0xabcd",
    actualHash: "0xdef0",
  }
  const snapshot: CamViewerSnapshot = {
    visitId: 7,
    integrityChecks: [verified, mismatch],
    integrityWarnings: [mismatch],
    canGoBack: false,
    route: "agreement",
    inputs: {},
    state: {},
    contractAddresses: { Escrow: "0x0000000000000000000000000000000000000011" },
    camURI: "https://example.test/main.json",
    uiURI: "https://example.test/ui.json",
    resolvedUi: { element: "Fragment", props: {}, children: [] },
    values: [],
    documentHashes: {
      terms: { status: "pending", source: "url", sourceURI: "https://example.test/terms" },
      submission: { status: "failed", source: "file", message: "The selected file could not be read." },
    },
  }

  const loaded = requireLoadedSnapshot(snapshot)
  assert.deepEqual(loaded, snapshot)
  assert.deepEqual(loaded.integrityChecks, [verified, mismatch])
  assert.deepEqual(loaded.integrityWarnings, [mismatch])
  assertResolvedSnapshot(loaded)

  // Every field that is optional before load and required afterwards
  // must cause an explicit refusal when absent; never invent defaults.
  for (const field of [
    "visitId", "integrityChecks", "integrityWarnings", "documentHashes",
    "route", "state", "contractAddresses", "camURI", "uiURI",
    "resolvedUi", "values",
  ] as const) {
    const { [field]: _missing, ...incomplete } = snapshot
    assert.throws(() => requireLoadedSnapshot(incomplete), /viewer snapshot is not loaded/, field)
    assert.throws(() => assertResolvedSnapshot(incomplete), /viewer snapshot is not loaded/, field)
  }
})
