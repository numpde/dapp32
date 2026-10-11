import assert from "node:assert/strict"
import test from "node:test"
import { UI_VERSION } from "@cam/protocol"

import { issueLocations, jsonBytes, replaceBundleResources, validateEditedRoot, viewEntryFunction } from "./fixtures.ts"
import type { RootWithNamespaces } from "./fixtures.ts"

test("control availability references must be backed by string-array handoff values", () => {
  for (const element of ["TextField", "Button"]) {
    for (const type of ["string[]", "string", "bool", "uint256[]"]) {
      const uiBytes = jsonBytes({
        ui: UI_VERSION,
        nodes: {
          app: {
            requires: ["view"],
            element,
            props: { label: "Publish" },
            ...(element === "TextField"
              ? { state: { key: "evidence", defaultValue: "" } }
              : { call: { namespace: "routes", function: "entry", args: {} } }),
            enabledWhen: { member: "publish", in: "$view.actions" },
          },
        },
      })
      const abiBytes = jsonBytes([{
        ...viewEntryFunction(),
        outputs: [{ name: "view", type: "tuple", components: [{ name: "actions", type }] }],
      }])
      const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => replaceBundleResources(root, bundle, { uiBytes, abiBytes }))
      assert.deepEqual(issueLocations(issues), type === "string[]"
        ? []
        : [["CAM_UI_TYPEFLOW_MISMATCH", "nodes.app.enabledWhen.in"]])
    }
  }
})

test("control availability references use ordinary UI root and handoff diagnostics", () => {
  for (const [source, expectedRule] of [
    ["$wallet.actions", "CAM_UI_EXPRESSION_ROOT_INVALID"],
    ["$view.missing", "CAM_UI_TYPEFLOW_MISMATCH"],
  ]) {
    const uiBytes = jsonBytes({
      ui: UI_VERSION,
      nodes: {
        app: {
          requires: ["view"],
          element: "TextField",
          props: { label: "Evidence" },
          state: { key: "evidence", defaultValue: "" },
          enabledWhen: { member: "publish", in: source },
        },
      },
    })
    const issues = validateEditedRoot<RootWithNamespaces>((root, bundle) => replaceBundleResources(root, bundle, { uiBytes }))
    assert.deepEqual(issueLocations(issues), [[expectedRule, "nodes.app.enabledWhen.in"]])
  }
})
