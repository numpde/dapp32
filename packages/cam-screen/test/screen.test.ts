import assert from "node:assert/strict"
import test from "node:test"

import {
  parseScreen,
  resolveScreen,
  ScreenError,
} from "../src/index.ts"
import { resolveAction } from "../src/actions.ts"
import type { ScreenAction, ScreenRuntimeContext } from "../src/index.ts"

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

test("resolveAction resolves navigation params", () => {
  const action: ScreenAction = {
    route: "component",
    params: {
      serialNumber: "$state.serialNumber",
    },
  }

  assert.deepEqual(resolveAction(action, context), {
    route: "component",
    params: {
      serialNumber: "XYZ789",
    },
  })
})

test("resolveAction resolves contract-call args and success navigation", () => {
  const action: ScreenAction = {
    contract: "BicycleComponentManager",
    function: "markMissing",
    args: ["$params.serialNumber", "$account.address"],
    onSuccess: {
      route: "component",
      params: {
        serialNumber: "$params.serialNumber",
      },
    },
  }

  assert.deepEqual(resolveAction(action, context), {
    contract: "BicycleComponentManager",
    function: "markMissing",
    args: ["ABC123", "0x0000000000000000000000000000000000000002"],
    onSuccess: {
      route: "component",
      params: {
        serialNumber: "ABC123",
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

test("resolveAction reports the exact action path for unresolved expressions", () => {
  const action: ScreenAction = {
    contract: "BicycleComponentManager",
    function: "markMissing",
    args: ["$params.missing"],
  }

  assert.throws(
    () => resolveAction(action, context),
    (error) =>
      error instanceof ScreenError
      && error.code === "SCREEN_UNRESOLVED_VALUE"
      && error.path === "action.args.0",
  )
})
