import assert from "node:assert/strict"
import test from "node:test"

import { toInertValue } from "@cam/protocol"
import type { InertValue } from "@cam/protocol"
import {
  resolveInitialScreen,
  parseScreen,
  resolveScreen,
} from "../src/index.ts"
import type { ScreenRuntimeContext } from "../src/index.ts"

const screenBaseContext = {
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
  values: [
    {
      exists: true,
      owner: "0x0000000000000000000000000000000000000003",
      tokenContract: "0x0000000000000000000000000000000000000004",
      tokenId: "42",
    },
  ],
}

const context: ScreenRuntimeContext = {
  ...screenBaseContext,
  form: {
    serialNumber: "XYZ789",
  },
}

test("resolveScreen resolves params, form, route values, and initial form values", () => {
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
      {
        type: "button",
        label: "Look up",
        action: {
          type: "navigate",
          route: "component",
          params: {
            serialNumber: "$form.serialNumber",
          },
        },
      },
      {
        type: "button",
        label: "Mark missing",
        action: {
          type: "contract-call",
          contract: "BicycleComponentManager",
          function: "markMissing",
          args: ["$form.serialNumber"],
          onSuccess: {
            type: "navigate",
            route: "component",
            params: {
              serialNumber: "$form.serialNumber",
            },
          },
        },
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
      value: "XYZ789",
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
    {
      type: "button",
      label: "Look up",
      action: {
        type: "navigate",
        route: "component",
        params: inert({
          serialNumber: "XYZ789",
        }),
      },
    },
    {
      type: "button",
      label: "Mark missing",
      action: {
        type: "contract-call",
        contract: "BicycleComponentManager",
        function: "markMissing",
        args: ["XYZ789"],
        onSuccess: {
          type: "navigate",
          route: "component",
          params: inert({
            serialNumber: "XYZ789",
          }),
        },
      },
    },
  ])

  const initial = resolveInitialScreen(screen, screenBaseContext)

  assert.deepEqual(initial.form, inert({
    serialNumber: "ABC123",
  }))
  assert.deepEqual(initial.resolvedScreen.elements.slice(0, 2), [
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
  ])
})

test("parseScreen requires explicit action types", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "button",
          label: "Look up",
          action: {
            route: "component",
            params: {},
          },
        },
      ],
    }),
    /elements\.0\.action\.type/,
  )
})

test("parseScreen rejects element control logic", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "text",
          text: "Registered",
          visibleWhen: "$values.0.exists",
        },
      ],
    }),
    /elements\.0\.visibleWhen/,
  )
})

test("parseScreen rejects layout-only group elements", () => {
  assert.throws(
    () => parseScreen({
      screen: "1.0.0",
      elements: [
        {
          type: "group",
          elements: [],
        },
      ],
    }),
    /elements\.0\.type/,
  )
})

function inert(value: unknown): InertValue {
  return toInertValue(value)
}
