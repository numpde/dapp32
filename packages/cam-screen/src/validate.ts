import { parseAction } from "./actions.ts"
import { SCREEN_VERSION } from "./constants.ts"
import { ScreenError } from "./errors.ts"
import { validateExpressionValue } from "./expressions.ts"
import {
  cloneJsonValue,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import type { ScreenDocument, ScreenElement } from "./types.ts"

const TOP_LEVEL_KEYS = new Set(["screen", "title", "elements"])
const TEXT_KEYS = new Set(["type", "text"])
const INPUT_KEYS = new Set(["type", "name", "label", "value"])
const ADDRESS_KEYS = new Set(["type", "label", "address"])
const BUTTON_KEYS = new Set(["type", "label", "action"])
const STATUS_KEYS = new Set(["type", "label", "value"])
const NFT_KEYS = new Set(["type", "contractAddress", "tokenId"])

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
  return {
    type: "text",
    text: parseExpressionString(source.text, `${path}.text`),
  }
}

function parseInputElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, INPUT_KEYS, path)
  if (source.value !== undefined) {
    validateExpressionValue(source.value, `${path}.value`)
  }

  return {
    type: "input",
    name: requiredNonEmptyString(source.name, `${path}.name`),
    label: parseExpressionString(source.label, `${path}.label`),
    ...(source.value === undefined ? {} : { value: cloneJsonValue(source.value) }),
  }
}

function parseAddressElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, ADDRESS_KEYS, path)
  return {
    type: "address",
    ...(source.label === undefined ? {} : { label: parseExpressionString(source.label, `${path}.label`) }),
    address: parseExpressionString(source.address, `${path}.address`),
  }
}

function parseButtonElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, BUTTON_KEYS, path)

  return {
    type: "button",
    label: parseExpressionString(source.label, `${path}.label`),
    action: parseAction(source.action, `${path}.action`),
  }
}

function parseStatusElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, STATUS_KEYS, path)
  return {
    type: "status",
    ...(source.label === undefined ? {} : { label: parseExpressionString(source.label, `${path}.label`) }),
    value: parseExpressionString(source.value, `${path}.value`),
  }
}

function parseNftElement(source: Record<string, unknown>, path: string): ScreenElement {
  rejectUnknownScreenFields(source, NFT_KEYS, path)
  validateExpressionValue(source.tokenId, `${path}.tokenId`)

  return {
    type: "nft",
    contractAddress: parseExpressionString(source.contractAddress, `${path}.contractAddress`),
    tokenId: cloneJsonValue(source.tokenId),
  }
}

function parseExpressionString(value: unknown, path: string): string {
  const string = requiredNonEmptyString(value, path)
  validateExpressionValue(string, path)
  return string
}

function rejectUnknownScreenFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  rejectUnknownFields(source, allowedKeys, path, (key) => `field is not allowed in screen ${SCREEN_VERSION}: ${key}`)
}
