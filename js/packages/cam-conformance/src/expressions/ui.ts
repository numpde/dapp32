import {
  collectExpressionReferences,
  UI_CONTEXT_KEYS,
  UI_PROP_SCHEMAS,
  isUiPropElement,
  isRecordObject,
} from "@cam/protocol"
import type { ExpressionReferenceOccurrence } from "@cam/protocol"
import { forEachUiNode } from "../ui/document.ts"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type { DeclaredUiDocument } from "../ui/resources.ts"

const RULES = conformanceRules({
  CAM_UI_EXPRESSION_ROOT_INVALID: {
    class: "A",
    reason: "UI expression syntax and root vocabulary are static publication properties.",
  },
})

export function validateUiExpressionRoots({
  uiDocument,
  issues,
}: {
  readonly uiDocument: DeclaredUiDocument | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  if (uiDocument === undefined) return

  const occurrences: ExpressionReferenceOccurrence[] = []
  forEachUiNode(uiDocument.document.nodes, (node, path) => {
    let literalProps: readonly string[] = []
    if (typeof node.element === "string" && isUiPropElement(node.element)) {
      const schema = UI_PROP_SCHEMAS[node.element]
      if ("literal" in schema) literalProps = schema.literal
    }
    for (const [field, value] of Object.entries(node)) {
      // The node walker owns children. Literal props are declared metadata,
      // so omit them structurally rather than matching ambiguous dotted paths.
      if (field === "children") continue
      if (field === "props" && isRecordObject(value)) {
        for (const [prop, propValue] of Object.entries(value)) {
          if (literalProps.includes(prop)) continue
          for (const occurrence of collectExpressionReferences(propValue, { numericSegments: true }, `${path}.props.${prop}`)) occurrences.push(occurrence)
        }
      } else {
        for (const occurrence of collectExpressionReferences(value, { numericSegments: true }, `${path}.${field}`)) occurrences.push(occurrence)
      }
    }
  })
  for (const occurrence of occurrences) {
    if (occurrence.syntaxError !== undefined) {
      issues.push(conformanceIssue({
        rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
        resource: uiDocument.resource,
        path: occurrence.path,
        message: occurrence.syntaxError,
      }))
      continue
    }

    const root = occurrence.reference?.root
    if (root === undefined || UI_CONTEXT_KEYS.has(root)) continue

    issues.push(conformanceIssue({
      rule: RULES.CAM_UI_EXPRESSION_ROOT_INVALID,
      resource: uiDocument.resource,
      path: occurrence.path,
      message: `UI expression root is not supported: ${root}`,
    }))
  }
}
