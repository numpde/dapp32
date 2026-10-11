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

test("declared Status formats preserve raw values while resolving exact readable text", () => {
  const cases = [
    { format: "bytes", value: "128", text: "128 bytes" },
    { format: "bytes", value: 1, text: "1 byte" },
    { format: "bytes", value: "9007199254740993", text: "9,007,199,254,740,993 bytes" },
    { format: "durationSeconds", value: "31536000", text: "365 days (31,536,000 seconds)" },
    { format: "durationSeconds", value: "90061", text: "1 day, 1 hour, 1 minute, 1 second (90,061 seconds)" },
    { format: "durationSeconds", value: "60", text: "1 minute (60 seconds)" },
    { format: "durationSeconds", value: "0", text: "0 seconds" },
    { format: "durationSeconds", value: "59", text: "59 seconds" },
    { format: "stringList", value: ["client", "contractor"], text: "client, contractor" },
    { format: "stringList", value: [], text: "None" },
  ]
  for (const { format, value, text } of cases) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: ["view"], element: "Status", props: { label: "Value", value: "$view.value", format } },
    } })
    const args = { view: toInertValue({ value }) }
    const resolved = resolveUiNode(ui, "app", args, context)
    assert.equal(resolved.element, "Status")
    assert.equal("formattedValue" in resolved && resolved.formattedValue, text)
    assert.deepEqual(resolved.props.value, toInertValue(value))
    assert.deepEqual(toInertValue(JSON.parse(JSON.stringify(resolved))), toInertValue(resolved))
    assert.deepEqual(args.view, toInertValue({ value }))
  }
})

test("Status without a format keeps inert values raw and invents no presentation semantics", () => {
  for (const value of ["31536000", "0x1234", ["client", "contractor"], { seconds: "60" }]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Unformatted", value } },
    } })
    const resolved = resolveUiNode(ui, "app", {}, context)
    assert.equal(Object.hasOwn(resolved, "formattedValue"), false)
    assert.deepEqual(resolved.props.value, toInertValue(value))
  }
})

test("duration presentation accounts for every second beyond floating-point integer precision", () => {
  const value = "9007199254740993"
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: [], element: "Status", props: { label: "Duration", value, format: "durationSeconds" } },
  } })
  const resolved = resolveUiNode(ui, "app", {}, context)
  assert.ok("formattedValue" in resolved && typeof resolved.formattedValue === "string")
  const text = resolved.formattedValue
  assert.ok(text.endsWith("(9,007,199,254,740,993 seconds)"))
  const secondsPerUnit: Record<string, bigint> = { day: 86400n, hour: 3600n, minute: 60n, second: 1n }
  const total = [...text.split(" (")[0].matchAll(/([\d,]+) (day|hour|minute|second)s?/g)]
    .reduce((sum, match) => sum + BigInt(match[1].replaceAll(",", "")) * secondsPerUnit[match[2]], 0n)
  assert.equal(total, BigInt(value))
})

test("declared integer presentation retains every digit of long values", () => {
  const value = `1${"0".repeat(3000)}`
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: [], element: "Status", props: { label: "Size", value, format: "bytes" } },
  } })
  const resolved = resolveUiNode(ui, "app", {}, context)
  assert.ok("formattedValue" in resolved && typeof resolved.formattedValue === "string")
  const groups = resolved.formattedValue.replace(/ bytes$/, "").split(",")
  assert.equal(groups.join(""), value)
  assert.equal(groups.length, 1001)
  assert.ok(groups.slice(1).every((group) => group.length === 3))
  assert.equal(resolved.props.value, value)
})

test("Status format declarations are literal supported presentation choices", () => {
  for (const format of ["unknown", "$view.format", "", true, null, ["bytes"]]) {
    assert.throws(() => parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: [], element: "Status", props: { label: "Value", value: "1", format } },
    } }), (error: unknown) => error instanceof UiError
      && error.code === "UI_INVALID_FIELD" && error.path === "nodes.app.props.format")
  }
})

test("formatted Status operands fail during resolution rather than after a view is published", () => {
  for (const format of ["bytes", "durationSeconds"]) {
    const ui = parseUi({ ui: UI_VERSION, nodes: {
      app: { requires: ["view"], element: "Status", props: { label: "Value", value: "$view.value", format } },
    } })
    for (const value of ["-1", "1.5", "1e3", "0x10", "", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, true, null, {}]) {
      assert.throws(() => resolveUiNode(ui, "app", { view: toInertValue({ value }) }, context),
        (error: unknown) => error instanceof UiError && error.code === "UI_INVALID_FIELD"
          && error.path === "app.props.value" && /non-negative.*integer/.test(error.message))
    }
  }
  const ui = parseUi({ ui: UI_VERSION, nodes: {
    app: { requires: ["view"], element: "Status", props: { label: "Choices", value: "$view.value", format: "stringList" } },
  } })
  for (const value of ["client", ["client", 2], [null], {}]) {
    assert.throws(() => resolveUiNode(ui, "app", { view: toInertValue({ value }) }, context),
      (error: unknown) => error instanceof UiError && error.code === "UI_INVALID_FIELD"
        && error.path === "app.props.value" && /array of strings/.test(error.message))
  }
})

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
