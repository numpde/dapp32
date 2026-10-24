import assert from "node:assert/strict"
import test from "node:test"

import type { CamViewerSnapshot } from "../../packages/cam-viewer/dist/index.js"
import { requireLoadedSnapshot } from "./snapshots.ts"

test("loaded snapshots preserve visit identity, integrity warnings and document hashing operations", () => {
  const snapshot: CamViewerSnapshot = {
    visitId: 7,
    integrityWarnings: [],
    canGoBack: false,
    route: "agreement",
    inputs: {},
    state: {},
    uiURI: "https://example.test/ui.json",
    resolvedUi: { element: "Fragment", props: {}, children: [] },
    values: [],
    documentHashes: {
      terms: { status: "pending", source: "url", sourceURI: "https://example.test/terms" },
      submission: { status: "failed", source: "file", message: "The selected file could not be read." },
    },
  }
  assert.deepEqual(requireLoadedSnapshot(snapshot), snapshot)

  for (const field of ["visitId", "integrityWarnings", "documentHashes"] as const) {
    const { [field]: _missing, ...incomplete } = snapshot
    assert.throws(() => requireLoadedSnapshot(incomplete), /viewer snapshot is not loaded/, field)
  }
})
