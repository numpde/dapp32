import { resolveActionAtPath } from "./actions.ts"
import { ScreenError } from "./errors.ts"
import { resolveValueAtPath } from "./expressions.ts"
import {
  createStringMap,
  hasOwn,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  ResolvedScreen,
  ResolvedScreenElement,
  ScreenDocument,
  ScreenElement,
  ScreenInitialContext,
  ScreenRuntimeContext,
} from "./types.ts"

export function resolveInitialScreen(
  screen: ScreenDocument,
  context: ScreenInitialContext,
): {
  readonly form: InertRecord
  readonly resolvedScreen: ResolvedScreen
} {
  const form = createInitialForm(screen, context)

  return {
    form,
    resolvedScreen: resolveScreen(screen, {
      ...context,
      form,
    }),
  }
}

function createInitialForm(screen: ScreenDocument, context: ScreenInitialContext): InertRecord {
  const form = createStringMap<InertValue>()
  // Input initializers run before the screen form exists. Resolving against an
  // empty form makes $form references fail through the normal expression path.
  const initializerContext = { ...context, form: createStringMap<InertValue>() }
  appendInitialFormValues(screen.elements, initializerContext, "elements", form)
  return form
}

export function resolveScreen(screen: ScreenDocument, context: ScreenRuntimeContext): ResolvedScreen {
  const elements: ResolvedScreenElement[] = []
  appendResolvedElements(screen.elements, context, "elements", elements)

  return {
    title: resolveStringField(screen.title, context, "title"),
    elements,
  }
}

function appendInitialFormValues(
  elements: readonly ScreenElement[],
  context: ScreenRuntimeContext,
  path: string,
  target: Record<string, InertValue>,
): void {
  for (const [index, element] of elements.entries()) {
    const elementPath = `${path}.${index}`

    if (element.type === "input") {
      if (hasOwn(target, element.name)) {
        throw new ScreenError("SCREEN_INVALID_FIELD", "duplicate input name", `${elementPath}.name`)
      }

      target[element.name] = resolveValueAtPath(element.value, context, `${elementPath}.value`)
    }
  }
}

function appendResolvedElements(
  elements: readonly ScreenElement[],
  context: ScreenRuntimeContext,
  path: string,
  target: ResolvedScreenElement[],
): void {
  for (const [index, element] of elements.entries()) {
    target.push(resolveElement(element, context, `${path}.${index}`))
  }
}

function resolveElement(
  element: ScreenElement,
  context: ScreenRuntimeContext,
  path: string,
): ResolvedScreenElement {
  switch (element.type) {
    case "text":
      return {
        type: "text",
        text: resolveStringField(element.text, context, `${path}.text`),
      }
    case "input":
      return {
        type: "input",
        name: element.name,
        label: resolveStringField(element.label, context, `${path}.label`),
        value: formValueForInput(element.name, context, `${path}.value`),
      }
    case "address":
      return {
        type: "address",
        label: resolveStringField(element.label, context, `${path}.label`),
        address: resolveStringField(element.address, context, `${path}.address`),
      }
    case "button":
      return {
        type: "button",
        label: resolveStringField(element.label, context, `${path}.label`),
        action: resolveActionAtPath(element.action, context, `${path}.action`),
      }
    case "status":
      return {
        type: "status",
        label: resolveStringField(element.label, context, `${path}.label`),
        value: resolveValueAtPath(element.value, context, `${path}.value`),
      }
    case "nft":
      return {
        type: "nft",
        contractAddress: resolveStringField(element.contractAddress, context, `${path}.contractAddress`),
        tokenId: resolveValueAtPath(element.tokenId, context, `${path}.tokenId`),
      }
  }
}

function formValueForInput(name: string, context: ScreenRuntimeContext, path: string): InertValue {
  if (!hasOwn(context.form, name)) {
    throw new ScreenError("SCREEN_UNRESOLVED_VALUE", `missing form value for input: ${name}`, path)
  }

  return context.form[name]
}

function resolveStringField(value: string, context: ScreenRuntimeContext, path: string): string {
  const resolved = resolveValueAtPath(value, context, path)
  if (typeof resolved !== "string") {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved string", path)
  }

  return resolved
}
