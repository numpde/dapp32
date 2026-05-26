import { CamError, toInertValue } from "@cam/core"
import { parseAction } from "./actions.ts"
import { SCREEN_VERSION } from "./constants.ts"
import { ScreenError } from "./errors.ts"
import { validateExpressionValue } from "./expressions.ts"
import {
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import type { ScreenDocument, ScreenElement } from "./types.ts"
import type { InertValue } from "@cam/core"

const TOP_LEVEL_KEYS = new Set(["screen", "title", "elements"])
const TEXT_KEYS = elementKeys("text")
const INPUT_KEYS = elementKeys("name", "label", "value")
const ADDRESS_KEYS = elementKeys("label", "address")
const BUTTON_KEYS = elementKeys("label", "action")
const STATUS_KEYS = elementKeys("label", "value")
const NFT_KEYS = elementKeys("contractAddress", "tokenId")

export function parseScreen(input: unknown): ScreenDocument {
  const source = requiredRecord(input, "")
  rejectUnknownScreenFields(source, TOP_LEVEL_KEYS, "")

  return {
    screen: parseScreenVersion(source.screen),
    ...(source.title === undefined ? {} : { title: parseExpressionString(source.title, "title") }),
    elements: parseElements(requiredArray(source.elements, "elements")),
  }
}

function parseScreenVersion(value: unknown): string {
  const version = requiredNonEmptyString(value, "screen")
  if (version !== SCREEN_VERSION) {
    throw new ScreenError("SCREEN_INVALID_FIELD", `unsupported screen version: ${version}`, "screen")
  }

  return version
}

function parseElements(source: readonly unknown[]): readonly ScreenElement[] {
  return source.map((element, index) => parseElement(element, `elements.${index}`))
}

function parseElement(input: unknown, path: string): ScreenElement {
  const source = requiredRecord(input, path)
  const type = requiredNonEmptyString(source.type, `${path}.type`)

  switch (type) {
    case "text":
      return parseTextElement(source, path)
    case "input":
      return parseInputElement(source, path)
    case "address":
      return parseAddressElement(source, path)
    case "button":
      return parseButtonElement(source, path)
    case "status":
      return parseStatusElement(source, path)
    case "nft":
      return parseNftElement(source, path)
    default:
      throw new ScreenError("SCREEN_INVALID_FIELD", `unknown screen element type: ${type}`, `${path}.type`)
  }
}

function parseTextElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, TEXT_KEYS, path)
  return withVisibility(source, path, {
    type: "text",
    text: parseExpressionString(source.text, `${path}.text`),
  })
}

function parseInputElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, INPUT_KEYS, path)

  return withVisibility(source, path, {
    type: "input",
    name: requiredNonEmptyString(source.name, `${path}.name`),
    label: parseExpressionString(source.label, `${path}.label`),
    ...(source.value === undefined ? {} : { value: parseExpressionPayload(source.value, `${path}.value`) }),
  })
}

function parseAddressElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, ADDRESS_KEYS, path)
  return withVisibility(source, path, {
    type: "address",
    ...(source.label === undefined ? {} : { label: parseExpressionString(source.label, `${path}.label`) }),
    address: parseExpressionString(source.address, `${path}.address`),
  })
}

function parseButtonElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, BUTTON_KEYS, path)

  return withVisibility(source, path, {
    type: "button",
    label: parseExpressionString(source.label, `${path}.label`),
    action: parseAction(source.action, `${path}.action`),
  })
}

function parseStatusElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, STATUS_KEYS, path)

  return withVisibility(source, path, {
    type: "status",
    ...(source.label === undefined ? {} : { label: parseExpressionString(source.label, `${path}.label`) }),
    value: parseExpressionPayload(source.value, `${path}.value`),
  })
}

function parseNftElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, NFT_KEYS, path)

  return withVisibility(source, path, {
    type: "nft",
    contractAddress: parseExpressionString(source.contractAddress, `${path}.contractAddress`),
    tokenId: parseExpressionPayload(source.tokenId, `${path}.tokenId`),
  })
}

function withVisibility<T extends object>(
  source: Record<string, unknown>,
  path: string,
  element: T,
): T & { readonly visibleWhen?: InertValue } {
  return source.visibleWhen === undefined
    ? element
    : { ...element, visibleWhen: parseExpressionPayload(source.visibleWhen, `${path}.visibleWhen`) }
}

function parseExpressionString(value: unknown, path: string): string {
  const string = requiredNonEmptyString(value, path)
  validateExpressionValue(string, path)
  return string
}

function parseExpressionPayload(value: unknown, path: string): InertValue {
  validateExpressionValue(value, path)
  try {
    return toInertValue(value)
  } catch (error) {
    if (error instanceof CamError) {
      throw new ScreenError("SCREEN_INVALID_FIELD", error.message, error.path === undefined ? path : `${path}.${error.path}`)
    }

    throw error
  }
}

function rejectUnknownScreenFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  rejectUnknownFields(source, allowedKeys, path, (key) => `field is not allowed in screen ${SCREEN_VERSION}: ${key}`)
}

function elementKeys(...keys: string[]): ReadonlySet<string> {
  return new Set(["type", "visibleWhen", ...keys])
}
