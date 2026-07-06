import assert from "node:assert/strict"
import test from "node:test"

import { parseCam } from "@cam/core"
import { CAM_VERSION, toInertValue, UI_VERSION } from "@cam/protocol"
import { UiError, parseUi } from "@cam/screen"
import type { CamDocument } from "@cam/core"
import type { CamHost } from "@cam/evm-viem"
import type { InertRecord } from "@cam/protocol"
import type { UiDocument } from "@cam/screen"
import type { Address } from "viem"

import { CamViewerError } from "../src/errors.ts"
import {
  resolveViewerCurrentUi,
  resolveViewerInitialUi,
} from "../src/ui-resolution.ts"

const host: CamHost = {
  chainId: "eip155:31337",
  address: "0x00000000000000000000000000000000000000cA",
}
const account = {
  address: "0x0000000000000000000000000000000000000aCc" as Address,
}

test("resolveViewerInitialUi resolves route continuations and initial state", () => {
  const result = resolveViewerInitialUi({
    cam: camDocument(),
    ui: uiDocument(),
    host,
    route: "entry",
    inputs: {
      serialNumber: "ABC123",
    },
    values: ["ready"],
  })

  assert.deepEqual(result.state, toInertValue({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(toInertValue(result.resolvedUi), toInertValue({
    element: "Screen",
    props: {
      title: "Demo",
    },
    children: [
      {
        element: "TextField",
        props: {
          label: "ready",
        },
        state: {
          key: "serialNumber",
        },
        children: [],
      },
      {
        element: "Text",
        props: {
          text: "ABC123",
        },
        children: [],
      },
    ],
  }))
})

test("resolveViewerCurrentUi re-resolves with supplied state", () => {
  const resolved = resolveViewerCurrentUi({
    cam: camDocument(),
    ui: uiDocument(),
    host,
    route: "entry",
    inputs: {
      serialNumber: "ABC123",
    },
    values: ["ready"],
    state: toInertValue({
      serialNumber: "UPDATED",
    }) as InertRecord,
  })

  assert.deepEqual(toInertValue(resolved), toInertValue({
    element: "Screen",
    props: {
      title: "Demo",
    },
    children: [
      {
        element: "TextField",
        props: {
          label: "ready",
        },
        state: {
          key: "serialNumber",
        },
        children: [],
      },
      {
        element: "Text",
        props: {
          text: "UPDATED",
        },
        children: [],
      },
    ],
  }))
})

test("resolveViewerCurrentUi rejects read routes whose continuation is not ui", () => {
  assert.throws(
    () => resolveViewerCurrentUi({
      cam: camWithThenNamespace("routes"),
      ui: uiDocument(),
      host,
      route: "badThen",
      inputs: {},
      values: [],
      state: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /continue to ui namespace/.test(error.message),
  )
})

test("resolveViewerCurrentUi maps anonymous account UI errors to viewer errors", () => {
  assert.throws(
    () => resolveViewerCurrentUi({
      cam: camDocument(),
      ui: uiDocument(),
      host,
      route: "accountUi",
      inputs: {},
      values: [],
      state: {},
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /UI requires an account/.test(error.message)
      && error.cause instanceof UiError,
  )
})

test("resolveViewerCurrentUi does not map unrelated UI errors", () => {
  assert.throws(
    () => resolveViewerCurrentUi({
      cam: camDocument(),
      ui: uiDocument(),
      host,
      route: "missingArgUi",
      inputs: {},
      values: [],
      state: {},
    }),
    (error) => error instanceof UiError
      && error.code === "UI_UNRESOLVED_VALUE",
  )
})

test("resolveViewerCurrentUi does not map account UI errors when account is present", () => {
  const resolved = resolveViewerCurrentUi({
    cam: camDocument(),
    ui: uiDocument(),
    host,
    account,
    route: "accountUi",
    inputs: {},
    values: [],
    state: {},
  })

  assert.deepEqual(toInertValue(resolved), toInertValue({
    element: "Text",
    props: {
      text: account.address,
    },
    children: [],
  }))
})

test("resolveViewerCurrentUi passes inputs, outputs, and state into UI context", () => {
  const resolved = resolveViewerCurrentUi({
    cam: camDocument(),
    ui: uiDocument(),
    host,
    route: "contextUi",
    inputs: {
      serialNumber: "ABC123",
    },
    values: ["ready"],
    state: toInertValue({
      note: "local",
    }) as InertRecord,
  })

  assert.deepEqual(toInertValue(resolved), toInertValue({
    element: "Screen",
    props: {
      title: "eip155:31337",
    },
    children: [
      {
        element: "Text",
        props: {
          text: "ABC123",
        },
        children: [],
      },
      {
        element: "Text",
        props: {
          text: "ready",
        },
        children: [],
      },
      {
        element: "Text",
        props: {
          text: "local",
        },
        children: [],
      },
    ],
  }))
})

function camDocument(): CamDocument {
  return parseCam({
    cam: CAM_VERSION,
    entry: "entry",
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
      entry: readRoute("app", {
        view: {
          serialNumber: "$inputs.serialNumber",
          status: "$outputs.0",
        },
      }, ["serialNumber"]),
      badThen: readRoute("app", {}, []),
      accountUi: readRoute("accountView", {}, []),
      missingArgUi: readRoute("strictView", {}, []),
      contextUi: readRoute("contextView", {
        view: {
          serialNumber: "$inputs.serialNumber",
          status: "$outputs.0",
        },
      }, ["serialNumber"]),
    },
  })
}

function camWithThenNamespace(namespace: string): CamDocument {
  const cam = camDocument()
  const badThen = cam.routes.badThen
  return {
    ...cam,
    routes: {
      ...cam.routes,
      badThen: {
        ...badThen,
        then: {
          ...badThen.then,
          namespace,
        },
      },
    },
  }
}

function readRoute(
  uiNode: string,
  thenArgs: InertRecord,
  inputs: readonly string[],
) {
  return {
    kind: "read",
    inputs,
    call: {
      namespace: "contracts.App",
      function: "read",
      args: {},
    },
    then: {
      namespace: "ui",
      function: uiNode,
      args: thenArgs,
    },
  }
}

function uiDocument(): UiDocument {
  return parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        props: {
          title: "Demo",
        },
        requires: ["view"],
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "fieldView",
              args: {
                view: "$view",
              },
            },
          },
          {
            element: "Text",
            props: {
              text: "$state.serialNumber",
            },
          },
        ],
      },
      accountView: {
        element: "Text",
        requires: [],
        props: {
          text: "$account.address",
        },
      },
      strictView: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view.serialNumber",
        },
      },
      contextView: {
        element: "Screen",
        requires: ["view"],
        props: {
          title: "$host.chainId",
        },
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "textView",
              args: {
                view: "$inputs.serialNumber",
              },
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "textView",
              args: {
                view: "$outputs.0",
              },
            },
          },
          {
            element: "Text",
            props: {
              text: "$state.note",
            },
          },
        ],
      },
      fieldView: {
        element: "TextField",
        requires: ["view"],
        props: {
          label: "$view.status",
        },
        state: {
          key: "serialNumber",
          defaultValue: "$view.serialNumber",
        },
      },
      textView: {
        element: "Text",
        requires: ["view"],
        props: {
          text: "$view",
        },
      },
    },
  })
}
