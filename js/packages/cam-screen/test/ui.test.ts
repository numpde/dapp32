import assert from "node:assert/strict"
import test from "node:test"

import { toInertValue, UI_VERSION } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import {
  forEachResolvedUiNode,
  parseUi,
  resolvedUiButtons,
  resolvedUiInputNames,
  resolveInitialUiNode,
  resolveUiNode,
  UiError,
} from "../src/index.ts"

const context = {
  host: {
    chainId: "eip155:31337",
    address: "0x0000000000000000000000000000000000000001",
  },
  account: {
    address: "0x0000000000000000000000000000000000000002",
  },
  inputs: {},
  outputs: [],
  state: {
    serialNumber: "ABC123",
  },
}

test("walks resolved UI trees in render order", () => {
  const visited: string[] = []

  forEachResolvedUiNode({
    element: "Screen",
    props: {},
    children: [
      {
        element: "TextField",
        props: {},
        state: { key: "serialNumber" },
        children: [] as const,
      },
      {
        element: "Button",
        props: {},
        call: {
          namespace: "routes",
          function: "lookupComponent",
          args: {},
        },
      },
    ],
  }, (node) => {
    visited.push(node.element)
  })

  assert.deepEqual(visited, ["Screen", "TextField", "Button"])
})

test("queries resolved UI buttons and input names deterministically", () => {
  const firstButton = {
    element: "Button" as const,
    props: {},
    call: {
      namespace: "routes",
      function: "lookupComponent",
      args: {},
    },
  }
  const secondButton = {
    element: "Button" as const,
    props: {},
    call: {
      namespace: "routes",
      function: "retireComponent",
      args: {},
    },
  }
  const resolved = {
    element: "Screen" as const,
    props: {},
    children: [
      {
        element: "TextField" as const,
        props: {},
        state: { key: "serialNumber" },
        children: [] as const,
      },
      {
        element: "Fragment" as const,
        props: {},
        children: [
          {
            element: "TextField" as const,
            props: {},
            state: { key: "owner" },
            children: [] as const,
          },
          {
            element: "TextField" as const,
            props: {},
            state: { key: "serialNumber" },
            children: [] as const,
          },
          firstButton,
        ],
      },
      secondButton,
    ],
  }

  assert.deepEqual(resolvedUiButtons(resolved), [firstButton, secondButton])
  assert.deepEqual(resolvedUiInputNames(resolved), ["owner", "serialNumber"])
})

test("resolves a UI catalog through Include nodes into render and action nodes", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: ["view"],
        props: {
          title: "Bicycle component registry",
        },
        children: [
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.viewId",
              args: {
                view: "$view",
              },
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "$view.actions",
              args: {},
            },
          },
        ],
      },
      entry: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "$view.serialNumber",
            },
          },
        ],
      },
      lookupComponent: {
        element: "Button",
        requires: [],
        props: {
          label: "Look up component",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
    },
  })

  const resolved = resolveUiNode(ui, "app", inertRecord({
    view: {
      viewId: "entry",
      actions: ["lookupComponent"],
      serialNumber: "",
    },
  }), context)

  assert.equal(resolved.element, "Screen")
  assert.equal(resolved.props.title, "Bicycle component registry")
  assert.equal(resolved.children.length, 2)

  const [view, action] = resolved.children
  assert.equal(view?.element, "Fragment")
  if (view?.element !== "Fragment") throw new Error("expected Fragment view")
  const firstChild = view.children[0]
  assert.equal(firstChild?.element, "TextField")
  if (firstChild?.element !== "TextField") throw new Error("expected TextField child")
  assert.equal(firstChild.state.key, "serialNumber")

  assert.equal(action?.element, "Button")
  assert.equal(action?.props.label, "Look up component")
  assert.equal(action?.call.namespace, "routes")
  assert.equal(action?.call.function, "component")
  assert.equal(action?.call.args.serialNumber, "ABC123")
})

test("resolveInitialUiNode skips action Include args until state exists", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Stateful action",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "ABC123",
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "lookupComponent",
              args: {
                view: {
                  serialNumber: "$state.serialNumber",
                },
              },
            },
          },
        ],
      },
      lookupComponent: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Look up component",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {
            serialNumber: "$view.serialNumber",
          },
        },
      },
    },
  })

  const { state, resolvedUi } = resolveInitialUiNode(ui, "app", inertRecord({}), context)
  assert.equal(resolvedUi.element, "Screen")
  if (resolvedUi.element !== "Screen") {
    throw new Error("expected Screen")
  }
  const action = resolvedUi.children.find((child) => child.element === "Button")

  assert.equal(state.serialNumber, "ABC123")
  assert.equal(action?.element, "Button")
  assert.equal(action?.call.args.serialNumber, "ABC123")
})

test("resolveInitialUiNode collects state before resolving state-backed render props", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Stateful render",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serialNumber",
              defaultValue: "ABC123",
            },
          },
          {
            element: "Include",
            call: {
              namespace: "ui",
              function: "actions",
              args: {
                view: {
                  serialNumber: "$state.serialNumber",
                },
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
      actions: {
        element: "Fragment",
        requires: ["view"],
        children: [
          {
            element: "Button",
            props: {
              label: "Look up component",
            },
            call: {
              namespace: "routes",
              function: "component",
              args: {
                serialNumber: "$view.serialNumber",
              },
            },
          },
        ],
      },
    },
  })

  const { state, resolvedUi } = resolveInitialUiNode(ui, "app", inertRecord({}), context)
  assert.equal(state.serialNumber, "ABC123")
  assert.equal(resolvedUi.element, "Screen")
  if (resolvedUi.element !== "Screen") {
    throw new Error("expected Screen")
  }
  const action = resolvedUiButtons(resolvedUi)[0]
  const text = resolvedUi.children.find((child) => child.element === "Text")

  assert.equal(action?.element, "Button")
  assert.equal(action?.call.args.serialNumber, "ABC123")
  assert.equal(text?.element, "Text")
  assert.equal(text?.props.text, "ABC123")
})

test("resolveUiNode rejects args that shadow runtime roots", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: [],
        props: {
          text: "shadow",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ state: {} }), context),
    /must not shadow runtime root: state/,
  )
})

test("resolveUiNode reports unresolved account as structured error details", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Button",
        requires: [],
        props: {
          label: "Use account",
        },
        call: {
          namespace: "routes",
          function: "entry",
          args: {
            account: "$account.address",
          },
        },
      },
    },
  })
  const anonymousContext = {
    host: context.host,
    inputs: context.inputs,
    outputs: context.outputs,
    state: context.state,
  }

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({}), anonymousContext),
    (error) => error instanceof UiError
      && error.code === "UI_UNRESOLVED_VALUE"
      && error.unresolvedRoot === "account",
  )
})

test("resolveInitialUiNode rejects TextField state keys that cannot be referenced from state", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Screen",
        requires: [],
        props: {
          title: "Invalid input",
        },
        children: [
          {
            element: "TextField",
            props: {
              label: "Serial number",
            },
            state: {
              key: "serial-number",
              defaultValue: "",
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => resolveInitialUiNode(ui, "app", inertRecord({}), context),
    /TextField state.key must resolve to an expression identifier: serial-number/,
  )
})

test("resolveUiNode rejects include cycles and undeclared node args", () => {
  const cyclic = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: [],
        call: {
          namespace: "ui",
          function: "app",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(cyclic, "app", inertRecord({}), context),
    /UI Include cycle detected: app -> app/,
  )

  const strictArgs = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Text",
        requires: [],
        props: {
          text: "strict",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(strictArgs, "app", inertRecord({ extra: "x" }), context),
    /not declared in requires: extra/,
  )
})

test("resolveUiNode rejects duplicate or empty Include selections", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
      item: {
        element: "Text",
        requires: [],
        props: {
          text: "Item",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ view: { nodes: ["item", "item"] } }), context),
    /must not duplicate node names: item/,
  )
  assert.throws(
    () => resolveUiNode(ui, "app", inertRecord({ view: { nodes: "" } }), context),
    /must not contain an empty node name/,
  )
})

test("parseUi rejects required arguments outside the UI node interface", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        app: {
          element: "Text",
          requires: ["foo"],
          props: {
            text: "unsupported argument",
          },
        },
      },
    }),
    /unsupported required argument: foo/,
  )
})

test("parseUi rejects stale screen-era and control fields", () => {
  assert.throws(
    () => parseUi({
      screen: "1.0.0",
      title: "Old screen",
      elements: [],
    }),
    /ui/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      title: "Metadata-like top-level fields are not UI nodes",
      nodes: {
        entry: {
          element: "Text",
          requires: [],
          props: {
            text: "Registered",
          },
        },
      },
    }),
    /title/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        entry: {
          element: "Text",
          requires: [],
          props: {
            text: "Registered",
          },
          visibleWhen: "$view.exists",
        },
      },
    }),
    /visibleWhen/,
  )
})

test("parseUi rejects calls wired to the wrong namespace", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        include: {
          element: "Include",
          requires: [],
          call: {
            namespace: "routes",
            function: "entry",
            args: {},
          },
        },
      },
    }),
    /ui namespace/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: "Bad action",
          },
          call: {
            namespace: "ui",
            function: "entry",
            args: {},
          },
        },
      },
    }),
    /routes namespace/,
  )
})

test("parseUi rejects statically invalid call function shapes", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: "Bad action",
          },
          call: {
            namespace: "routes",
            function: ["entry"],
            args: {},
          },
        },
      },
    }),
    /Button function must be a string/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        include: {
          element: "Include",
          requires: [],
          call: {
            namespace: "ui",
            function: ["entry", false],
            args: {},
          },
        },
      },
    }),
    /Include function array items must be strings/,
  )
})

test("parseUi and resolveUiNode reject invalid element props", () => {
  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        text: {
          element: "Text",
          requires: [],
          props: {
            label: "not a text prop",
          },
        },
      },
    }),
    /text/,
  )

  assert.throws(
    () => parseUi({
      ui: UI_VERSION,
      nodes: {
        action: {
          element: "Button",
          requires: [],
          props: {
            label: false,
          },
          call: {
            namespace: "routes",
            function: "component",
            args: {},
          },
        },
      },
    }),
    /label/,
  )

  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      action: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "$view.label",
        },
        call: {
          namespace: "routes",
          function: "component",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        label: false,
      },
    }), context),
    /label/,
  )

  const addressUi = parseUi({
    ui: UI_VERSION,
    nodes: {
      owner: {
        element: "Address",
        requires: ["view"],
        props: {
          label: "Owner",
          address: "$view.owner",
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(addressUi, "owner", inertRecord({
      view: {
        owner: "not-an-address",
      },
    }), context),
    /must resolve to an address: address/,
  )
})

test("resolveUiNode fails closed on missing required arguments and non-string action functions", () => {
  const ui = parseUi({
    ui: UI_VERSION,
    nodes: {
      action: {
        element: "Button",
        requires: ["view"],
        props: {
          label: "Broken",
        },
        call: {
          namespace: "routes",
          function: "$view.actions",
          args: {},
        },
      },
    },
  })

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({}), context),
    /view/,
  )

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        actions: ["component"],
      },
    }), context),
    /call function must resolve to a string/,
  )

  assert.throws(
    () => resolveUiNode(ui, "action", inertRecord({
      view: {
        actions: "",
      },
    }), context),
    /call function must resolve to a non-empty string/,
  )
})

function inertRecord(value: unknown): InertRecord {
  return toInertValue(value) as InertRecord
}
