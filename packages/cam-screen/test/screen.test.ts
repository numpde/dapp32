import assert from "node:assert/strict"
import test from "node:test"

import * as camScreen from "../src/index.ts"
import {
  parseScreen,
  resolveScreen,
  ScreenError,
} from "../src/index.ts"
import type { ScreenRuntimeContext } from "../src/index.ts"

const context: ScreenRuntimeContext = {
  host: {
    chainId: "eip155:31337",
    address: "0x0000000000000000000000000000000000000001",
  },
  account: {
    address: "0x0000000000000000000000000000000000000002",
  },
  params: {
    serialNumber: "ABC123",
  },
  state: {
    serialNumber: "XYZ789",
  },
  values: [
    {
      exists: true,
      owner: "0x0000000000000000000000000000000000000003",
      tokenContract: "0x0000000000000000000000000000000000000004",
      tokenId: "42",
    },
  ],
}

test("keeps the public API to the CAM screen boundary", () => {
  assert.deepEqual(Object.keys(camScreen).sort(), [
    "ScreenError",
    "parseScreen",
    "resolveScreen",
  ])
})

test("parseScreen accepts a minimal text and button screen", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    title: "Look up component",
    elements: [
      {
        type: "text",
        text: "Enter the serial number stamped on the frame.",
      },
      {
        type: "button",
        label: "Look up",
        action: {
          route: "component",
          params: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
    ],
  })

  assert.equal(screen.screen, "1.0.0")
  assert.equal(screen.title, "Look up component")
  assert.equal(screen.elements.length, 2)
})

test("parseScreen rejects unknown top-level fields", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [],
      layout: {},
    }),
    (error) => error instanceof ScreenError && error.code === "SCREEN_INVALID_FIELD",
  )
})

test("parseScreen rejects unknown element types", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "html",
          html: "<strong>unsafe</strong>",
        },
      ],
    }),
    (error) => error instanceof ScreenError && error.code === "SCREEN_INVALID_FIELD",
  )
})

test("parseScreen rejects sparse element arrays", () => {
  const elements = [{ type: "text", text: "Present" }, { type: "text", text: "Missing" }] as unknown[]
  delete elements[1]

  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements,
    }),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_INVALID_FIELD"
      && error.path === "elements.1",
  )
})

test("parseScreen rejects invalid button actions", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "button",
          label: "Ambiguous",
          action: {
            route: "component",
            contract: "BicycleComponentManager",
            function: "markMissing",
            args: [],
            params: {},
          },
        },
      ],
    }),
    (error) => error instanceof ScreenError && error.code === "SCREEN_INVALID_FIELD",
  )
})

test("parseScreen rejects sparse action arg arrays", () => {
  const args = ["present", "missing"] as unknown[]
  delete args[1]

  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "button",
          label: "Mark missing",
          action: {
            contract: "BicycleComponentManager",
            function: "markMissing",
            args,
          },
        },
      ],
    }),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_INVALID_FIELD"
      && error.path === "elements.0.action.args.1",
  )
})

test("resolveScreen resolves params, state, and route values", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    title: "$params.serialNumber",
    elements: [
      {
        type: "input",
        name: "serialNumber",
        label: "$params.serialNumber",
        value: "$params.serialNumber",
      },
      {
        type: "status",
        label: "Registered",
        value: "$values.0.exists",
      },
      {
        type: "nft",
        contractAddress: "$values.0.tokenContract",
        tokenId: "$values.0.tokenId",
      },
    ],
  })

  const resolved = resolveScreen(screen, context)

  assert.equal(resolved.title, "ABC123")
  assert.deepEqual(resolved.elements, [
    {
      type: "input",
      name: "serialNumber",
      label: "ABC123",
      value: "ABC123",
    },
    {
      type: "status",
      label: "Registered",
      value: true,
    },
    {
      type: "nft",
      contractAddress: "0x0000000000000000000000000000000000000004",
      tokenId: "42",
    },
  ])
})

test("resolveScreen filters elements with false visibility guards", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "status",
        label: "Registered",
        value: "$values.0.exists",
      },
      {
        type: "address",
        label: "Owner",
        visibleWhen: "$values.0.exists",
        address: "$values.0.owner",
      },
      {
        type: "status",
        label: "Hidden unresolved value",
        visibleWhen: false,
        value: "$state.missing",
      },
    ],
  })

  assert.deepEqual(resolveScreen(screen, context).elements, [
    {
      type: "status",
      label: "Registered",
      value: true,
    },
    {
      type: "address",
      label: "Owner",
      address: "0x0000000000000000000000000000000000000003",
    },
  ])
})

test("resolveScreen flattens visible groups and skips hidden groups", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "group",
        visibleWhen: "$values.0.exists",
        elements: [
          {
            type: "address",
            label: "Owner",
            address: "$values.0.owner",
          },
        ],
      },
      {
        type: "group",
        visibleWhen: false,
        elements: [
          {
            type: "status",
            label: "Hidden unresolved value",
            value: "$state.missing",
          },
        ],
      },
    ],
  })

  assert.deepEqual(resolveScreen(screen, context).elements, [
    {
      type: "address",
      label: "Owner",
      address: "0x0000000000000000000000000000000000000003",
    },
  ])
})

test("resolveScreen requires visibility guards to resolve to booleans", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "status",
        visibleWhen: "$params.serialNumber",
        value: true,
      },
    ],
  })

  assert.throws(
    () => resolveScreen(screen, context),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_INVALID_FIELD"
      && error.path === "elements.0.visibleWhen",
  )
})

test("resolveScreen resolves navigation action params", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "button",
        label: "Look up",
        action: {
          route: "component",
          params: {
            serialNumber: "$state.serialNumber",
          },
        },
      },
    ],
  })

  assert.deepEqual(resolveScreen(screen, context).elements[0], {
    type: "button",
    label: "Look up",
    action: {
      route: "component",
      params: {
        serialNumber: "XYZ789",
      },
    },
  })
})

test("resolveScreen resolves contract-call args and success navigation", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "button",
        label: "Mark missing",
        action: {
          contract: "BicycleComponentManager",
          function: "markMissing",
          args: ["$params.serialNumber", "$account.address"],
          onSuccess: {
            route: "component",
            params: {
              serialNumber: "$params.serialNumber",
            },
          },
        },
      },
    ],
  })

  assert.deepEqual(resolveScreen(screen, context).elements[0], {
    type: "button",
    label: "Mark missing",
    action: {
      contract: "BicycleComponentManager",
      function: "markMissing",
      args: ["ABC123", "0x0000000000000000000000000000000000000002"],
      onSuccess: {
        route: "component",
        params: {
          serialNumber: "ABC123",
        },
      },
    },
  })
})

test("parseScreen rejects unsupported expression roots", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "text",
          text: "$outputs.owner",
        },
      ],
    }),
    (error) => error instanceof ScreenError && error.code === "SCREEN_INVALID_EXPRESSION",
  )
})

test("resolveScreen reports the exact field path for unresolved expressions", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "status",
        value: "$state.missing",
      },
    ],
  })

  assert.throws(
    () => resolveScreen(screen, context),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_UNRESOLVED_VALUE"
      && error.path === "elements.0.value",
  )
})

test("resolveScreen reports the exact button action path for unresolved expressions", () => {
  const screen = parseScreen({
    screen: "1.0.0",
    elements: [
      {
        type: "button",
        label: "Mark missing",
        action: {
          contract: "BicycleComponentManager",
          function: "markMissing",
          args: ["$params.missing"],
        },
      },
    ],
  })

  assert.throws(
    () => resolveScreen(screen, context),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_UNRESOLVED_VALUE"
      && error.path === "elements.0.action.args.0",
  )
})
