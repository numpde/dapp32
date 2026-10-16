import type { ResolvedButtonNode, ResolvedUiNode } from "./types.ts"

export function forEachResolvedUiNode(
  root: ResolvedUiNode,
  visit: (node: ResolvedUiNode) => void,
): void {
  // Resolved UI trees have already erased Include nodes; only rendered
  // element nodes carry children. Keep that traversal fact screen-owned.
  visit(root)
  if (!("children" in root)) return

  for (const child of root.children) {
    forEachResolvedUiNode(child, visit)
  }
}

export function resolvedUiButtons(root: ResolvedUiNode): readonly ResolvedButtonNode[] {
  const buttons: ResolvedButtonNode[] = []
  forEachResolvedUiNode(root, (node) => {
    if (node.element === "Button") {
      buttons.push(node)
    }
  })
  return buttons
}

export function resolvedUiInputNames(root: ResolvedUiNode): readonly string[] {
  const names = new Set<string>()
  forEachResolvedUiNode(root, (node) => {
    if (node.element === "TextField" || node.element === "DocumentHashField" || node.element === "AmountField" || node.element === "NonNegativeIntegerField" || node.element === "DurationField") {
      names.add(node.state.key)
    }
  })
  return [...names].sort()
}
