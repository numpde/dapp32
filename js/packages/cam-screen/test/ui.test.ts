import assert from "node:assert/strict"
import test from "node:test"

import { toInertValue } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import {
  parseUi,
  resolveInitialUiNode,
  resolveUiNode,
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

test("resolves a UI catalog through Include nodes into render and action nodes", () => {
  const ui = parseUi({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Screen",
        requires: ["view"],
        props: {
          title: "Bicycle component registry",
        },
        children: [
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "$view.viewId",
              args: {
                view: "$view",
              },
            },
          },
          {
            tag: "Include",
            call: {
              namespace: "ui",
              function: "$view.actions",
              args: {},
            },
          },
        ],
      },
      entry: {
        tag: "Fragment",
        requires: ["view"],
        children: [
          {
            tag: "Input",
            props: {
              name: "serialNumber",
              label: "Serial number",
              value: "$view.serialNumber",
            },
          },
        ],
      },
      lookupComponent: {
        tag: "Action",
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

  assert.equal(resolved.tag, "Screen")
  assert.equal(resolved.props.title, "Bicycle component registry")
  assert.equal(resolved.children.length, 2)

  const [view, action] = resolved.children
  assert.equal(view?.tag, "Fragment")
  assert.equal(view?.children[0]?.tag, "Input")
  assert.equal(view?.children[0]?.props.name, "serialNumber")
  assert.equal(view?.children[0]?.props.value, "")

  assert.equal(action?.tag, "Action")
  assert.equal(action?.props.label, "Look up component")
  assert.equal(action?.call.namespace, "routes")
  assert.equal(action?.call.function, "component")
  assert.equal(action?.call.args.serialNumber, "ABC123")
})

test("resolveUiNode rejects args that shadow runtime roots", () => {
  const ui = parseUi({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Text",
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

test("resolveInitialUiNode rejects Input names that cannot be referenced from state", () => {
  const ui = parseUi({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Screen",
        requires: [],
        props: {
          title: "Invalid input",
        },
        children: [
          {
            tag: "Input",
            props: {
              name: "serial-number",
              label: "Serial number",
              value: "",
            },
          },
        ],
      },
    },
  })

  assert.throws(
    () => resolveInitialUiNode(ui, "app", inertRecord({}), context),
    /Input props.name must resolve to an expression identifier: serial-number/,
  )
})

test("resolveUiNode rejects include cycles and undeclared node args", () => {
  const cyclic = parseUi({
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Include",
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
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Text",
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
    ui: "1.0.0",
    nodes: {
      app: {
        tag: "Include",
        requires: ["view"],
        call: {
          namespace: "ui",
          function: "$view.nodes",
          args: {},
        },
      },
      item: {
        tag: "Text",
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
      ui: "1.0.0",
      nodes: {
        app: {
          tag: "Text",
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
      ui: "1.0.0",
      title: "Metadata-like top-level fields are not UI nodes",
      nodes: {
        entry: {
          tag: "Text",
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
      ui: "1.0.0",
      nodes: {
        entry: {
          tag: "Text",
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
      ui: "1.0.0",
      nodes: {
        include: {
          tag: "Include",
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
      ui: "1.0.0",
      nodes: {
        action: {
          tag: "Action",
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
      ui: "1.0.0",
      nodes: {
        action: {
          tag: "Action",
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
    /Action function must be a string/,
  )

  assert.throws(
    () => parseUi({
      ui: "1.0.0",
      nodes: {
        include: {
          tag: "Include",
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

test("parseUi and resolveUiNode reject invalid tag props", () => {
  assert.throws(
    () => parseUi({
      ui: "1.0.0",
      nodes: {
        text: {
          tag: "Text",
          requires: [],
          props: {
            label: "not a text prop",
          },
        },
      },
    }),
    /text/,
  )

  const ui = parseUi({
    ui: "1.0.0",
    nodes: {
      action: {
        tag: "Action",
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
})

test("resolveUiNode fails closed on missing required arguments and non-string action functions", () => {
  const ui = parseUi({
    ui: "1.0.0",
    nodes: {
      action: {
        tag: "Action",
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
