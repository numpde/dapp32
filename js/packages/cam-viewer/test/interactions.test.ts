import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { CAM_VERSION } from "@cam/protocol"
import type { ResolvedButtonNode, ResolvedUiNode } from "@cam/screen"

import { CamViewerError } from "../src/errors.ts"
import {
  assertActionIsRendered,
  assertStatePatchTargets,
  interpretRenderedAction,
} from "../src/interactions.ts"

const readAction = button("readRoute", {
  nested: {
    first: "a",
    second: ["b", "c"],
  },
})
const writeAction = button("writeRoute", {
  serialNumber: "ABC123",
})

test("interpretRenderedAction returns navigation for rendered read routes", () => {
  assert.deepEqual(interpretRenderedAction(camDocument(), readAction), {
    type: "navigate",
    route: "readRoute",
    inputs: readAction.call.args,
  })
})

test("interpretRenderedAction returns contract calls for rendered write routes", () => {
  assert.deepEqual(interpretRenderedAction(camDocument(), writeAction), {
    type: "contractCall",
    route: "writeRoute",
    inputs: writeAction.call.args,
  })
})

test("interpretRenderedAction rejects non-routes button namespaces", () => {
  assert.throws(
    () => interpretRenderedAction(camDocument(), {
      ...readAction,
      call: {
        ...readAction.call,
        namespace: "ui",
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /routes namespace/.test(error.message),
  )
})

test("interpretRenderedAction rejects unknown routes", () => {
  assert.throws(
    () => interpretRenderedAction(camDocument(), button("missingRoute", {})),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /unknown route/.test(error.message),
  )
})

test("assertActionIsRendered treats inert record args as order-insensitive", () => {
  assert.doesNotThrow(() => assertActionIsRendered(resolvedUi(), {
    ...readAction,
    call: {
      ...readAction.call,
      args: {
        nested: {
          second: ["b", "c"],
          first: "a",
        },
      },
    },
  }))
})

test("assertActionIsRendered rejects fabricated route actions", () => {
  assert.throws(
    () => assertActionIsRendered(resolvedUi(), button("writeRoute", { serialNumber: "hidden" })),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /not rendered/.test(error.message),
  )
})

test("assertActionIsRendered rejects stale actions with changed args", () => {
  assert.throws(
    () => assertActionIsRendered(resolvedUi(), button("readRoute", {
      nested: {
        first: "stale",
        second: ["b", "c"],
      },
    })),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /not rendered/.test(error.message),
  )
})

test("assertActionIsRendered treats inert arrays as order-sensitive", () => {
  assert.throws(
    () => assertActionIsRendered(resolvedUi(), button("readRoute", {
      nested: {
        first: "a",
        second: ["c", "b"],
      },
    })),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED",
  )
})

test("assertStatePatchTargets accepts rendered TextField state keys", () => {
  assert.doesNotThrow(() => assertStatePatchTargets(resolvedUi(), {
    serialNumber: "ABC123",
  }))
})

test("assertStatePatchTargets rejects unrendered state keys", () => {
  assert.throws(
    () => assertStatePatchTargets(resolvedUi(), {
      typoSerialNumber: "ABC123",
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_INVALID_INERT_VALUE"
      && /no rendered input/.test(error.message),
  )
})

function camDocument() {
  return parseCam({
    cam: CAM_VERSION,
    entry: "readRoute",
    namespaces: {
      "contracts.App": {
        type: "contract",
        abiURI: "./cam/abi/App.json",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      routes: {
        type: "routes",
      },
      ui: {
        type: "ui",
        uri: "./cam/ui.json",
        integrity: "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    },
    routes: {
      readRoute: {
        kind: "read",
        inputs: [],
        call: {
          namespace: "contracts.App",
          function: "read",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {},
        },
      },
      writeRoute: {
        kind: "write",
        inputs: ["serialNumber"],
        call: {
          namespace: "contracts.App",
          function: "write",
          args: {
            serialNumber: "$inputs.serialNumber",
          },
        },
        then: {
          namespace: "routes",
          function: "readRoute",
          args: {},
        },
      },
    },
  })
}

function resolvedUi(): ResolvedUiNode {
  return {
    element: "Screen",
    props: {},
    children: [
      {
        element: "TextField",
        props: {
          label: "Serial number",
        },
        state: {
          key: "serialNumber",
          defaultValue: "",
        },
        children: [],
      },
      readAction,
      writeAction,
    ],
  }
}

function button(route: string, args: ResolvedButtonNode["call"]["args"]): ResolvedButtonNode {
  return {
    element: "Button",
    props: {
      label: route,
    },
    call: {
      namespace: "routes",
      function: route,
      args,
    },
  }
}
