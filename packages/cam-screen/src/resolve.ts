import { resolveActionAtPath } from "./actions.ts"
import { ScreenError } from "./errors.ts"
import { resolveValueAtPath } from "./expressions.ts"
import type {
  ResolvedScreen,
  ResolvedScreenElement,
  ScreenDocument,
  ScreenElement,
  ScreenRuntimeContext,
} from "./types.ts"

export function resolveScreen(screen: ScreenDocument, context: ScreenRuntimeContext): ResolvedScreen {
  return {
    ...(screen.title === undefined ? {} : { title: resolveStringField(screen.title, context, "title") }),
    elements: resolveElements(screen.elements, context, "elements"),
  }
}

function resolveElements(
  elements: readonly ScreenElement[],
  context: ScreenRuntimeContext,
  path: string,
): readonly ResolvedScreenElement[] {
  return elements.flatMap((element, index) => {
    const elementPath = `${path}.${index}`
    return isElementVisible(element, context, elementPath)
      ? resolveElement(element, context, elementPath)
      : []
  })
}

function isElementVisible(element: ScreenElement, context: ScreenRuntimeContext, path: string): boolean {
  if (element.visibleWhen === undefined) {
    return true
  }

  const visible = resolveValueAtPath(element.visibleWhen, context, `${path}.visibleWhen`)
  if (typeof visible !== "boolean") {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved boolean", `${path}.visibleWhen`)
  }

  return visible
}

function resolveElement(
  element: ScreenElement,
  context: ScreenRuntimeContext,
  path: string,
): readonly ResolvedScreenElement[] {
  switch (element.type) {
    case "text":
      return [{
        type: "text",
        text: resolveStringField(element.text, context, `${path}.text`),
      }]
    case "input":
      return [{
        type: "input",
        name: element.name,
        label: resolveStringField(element.label, context, `${path}.label`),
        ...(element.value === undefined ? {} : { value: resolveValueAtPath(element.value, context, `${path}.value`) }),
      }]
    case "address":
      return [{
        type: "address",
        ...(element.label === undefined ? {} : { label: resolveStringField(element.label, context, `${path}.label`) }),
        address: resolveStringField(element.address, context, `${path}.address`),
      }]
    case "button":
      return [{
        type: "button",
        label: resolveStringField(element.label, context, `${path}.label`),
        action: resolveActionAtPath(element.action, context, `${path}.action`),
      }]
    case "status":
      return [{
        type: "status",
        ...(element.label === undefined ? {} : { label: resolveStringField(element.label, context, `${path}.label`) }),
        value: resolveValueAtPath(element.value, context, `${path}.value`),
      }]
    case "nft":
      return [{
        type: "nft",
        contractAddress: resolveStringField(element.contractAddress, context, `${path}.contractAddress`),
        tokenId: resolveValueAtPath(element.tokenId, context, `${path}.tokenId`),
      }]
    case "group":
      return resolveElements(element.elements, context, `${path}.elements`)
  }
}

function resolveStringField(value: string, context: ScreenRuntimeContext, path: string): string {
  const resolved = resolveValueAtPath(value, context, path)
  if (typeof resolved !== "string") {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved string", path)
  }

  return resolved
}
