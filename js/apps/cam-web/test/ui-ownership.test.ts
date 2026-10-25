import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { parseSync, type ESTree } from "vite"

type Source = { readonly name: string; readonly text: string }
type Binding = { readonly scope: Scope; readonly expression: ESTree.Node; readonly member?: string } | string | undefined
type Scope = { readonly parent: Scope | undefined; readonly bindings: Map<string, Binding>; readonly kind: "module" | "function" | "block" }
type LocatedNode = { readonly node: ESTree.Node; readonly owner: string; readonly scope: Scope }

function property(node: ESTree.Node): string | undefined {
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  return undefined
}

function bind(pattern: ESTree.Node, scope: Scope, expression: ESTree.Node | undefined, evaluation: Scope, member?: string): void {
  if (pattern.type === "Identifier") {
    scope.bindings.set(pattern.name, expression === undefined ? undefined : { scope: evaluation, expression, ...(member === undefined ? {} : { member }) })
  } else if (pattern.type === "ObjectPattern") {
    for (const item of pattern.properties) if (item.type === "Property") {
      const key = property(item.key)
      bind(item.value, scope, expression, evaluation, member === undefined ? key : key === undefined ? undefined : `${member}.${key}`)
    }
  } else if (pattern.type === "ArrayPattern") {
    for (const item of pattern.elements) if (item !== null) bind(item, scope, undefined, evaluation)
  } else if (pattern.type === "AssignmentPattern") bind(pattern.left, scope, expression, evaluation, member)
  else if (pattern.type === "RestElement") bind(pattern.argument, scope, undefined, evaluation)
}

function* walk(value: unknown, owner: string, enclosing: Scope): Generator<LocatedNode> {
  if (value === null || typeof value !== "object") return
  if (Array.isArray(value)) { for (const child of value) yield* walk(child, owner, enclosing); return }
  if (!("type" in value)) return
  const node = value as ESTree.Node
  let scope = enclosing
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    scope = { parent: enclosing, bindings: new Map(), kind: "function" }
    owner = `${owner}@${node.start}`
    if (node.type === "FunctionDeclaration" && node.id !== null) enclosing.bindings.set(node.id.name, undefined)
    for (const parameter of node.params) bind(parameter, scope, undefined, scope)
  } else if (node.type === "BlockStatement" || node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement" || node.type === "CatchClause") {
    scope = { parent: enclosing, bindings: new Map(), kind: "block" }
    if (node.type === "CatchClause" && node.param !== null) bind(node.param, scope, undefined, scope)
  }
  if (node.type === "VariableDeclaration") {
    let declaring = scope
    if (node.kind === "var") while (declaring.kind === "block" && declaring.parent !== undefined) declaring = declaring.parent
    for (const declaration of node.declarations) bind(declaration.id, declaring, declaration.init === null ? undefined : declaration.init, scope)
  }
  if (node.type === "ImportDeclaration") for (const item of node.specifiers) scope.bindings.set(item.local.name, node.source.value === "react" ? item.type === "ImportSpecifier" ? `react.${property(item.imported)}` : "react" : undefined)
  yield { node, owner, scope }
  for (const child of Object.values(node)) yield* walk(child, owner, scope)
}

function reference(node: ESTree.Node, scope: Scope, seen: Set<Binding>): string | undefined {
  if (node.type === "Identifier") {
    let declaring: Scope | undefined = scope
    while (declaring !== undefined && !declaring.bindings.has(node.name)) declaring = declaring.parent
    const binding = declaring?.bindings.get(node.name)
    if (binding === undefined || seen.has(binding)) return undefined
    if (typeof binding === "string") return binding
    seen.add(binding)
    const base = reference(binding.expression, binding.scope, seen)
    return base === undefined || binding.member === undefined ? base : `${base}.${binding.member}`
  }
  if (node.type === "Literal" && typeof node.value === "string") return `literal:${node.value}`
  if (node.type === "ChainExpression" || node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression" || node.type === "TSNonNullExpression" || node.type === "TSTypeAssertion") return reference(node.expression, scope, seen)
  if (node.type !== "MemberExpression") return undefined
  const base = reference(node.object, scope, seen)
  const key = node.computed ? reference(node.property, scope, seen) : `literal:${property(node.property)}`
  if (base === undefined || key === undefined || !key.startsWith("literal:")) return undefined
  return `${base}.${key.slice(8)}`
}

// This is a source ownership check for statically named JSX and browser APIs,
// not an interpreter for dynamic React construction or a JavaScript sandbox.
function ownershipFailures(sources: readonly Source[]): string[] {
  const failures: string[] = []
  const factOwners = new Map<string, Set<string>>()
  const clipboardOwners = new Set<string>()
  for (const { name, text } of sources) {
    const parsed = parseSync(name, text)
    if (parsed.errors.length !== 0) { failures.push(`${name}: cannot check invalid source`); continue }
    const globals: Scope = { parent: undefined, bindings: new Map(["navigator", "window", "globalThis", "document"].map(name => [name, name])), kind: "module" }
    const module: Scope = { parent: globals, bindings: new Map(), kind: "module" }
    const nodes = [...walk(parsed.program, name, module)]
    for (const { node, owner, scope } of nodes) {
      const path = reference(node, scope, new Set())
      if (["navigator.clipboard", "window.navigator.clipboard", "globalThis.navigator.clipboard"].some(base => path === base || path?.startsWith(`${base}.`))) clipboardOwners.add(owner)
      let tag: string | undefined
      if (node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier") tag = node.name.name
      if (node.type === "CallExpression") {
        const callee = reference(node.callee, scope, new Set())
        if (callee === "react.createElement" && node.arguments[0] !== undefined) { const value = reference(node.arguments[0], scope, new Set()); if (value?.startsWith("literal:")) tag = value.slice(8) }
        if ((callee === "document.execCommand" || callee === "window.document.execCommand" || callee === "globalThis.document.execCommand") && node.arguments[0] !== undefined && property(node.arguments[0]) === "copy") failures.push(`${owner}: legacy clipboard copy bypasses the shared owner`)
      }
      // Groups may contain read-only controls such as Copy; each edit control owns its disabled state.
      if (tag === "fieldset") {
        const disabled = node.type === "JSXOpeningElement"
          ? node.attributes.some(attribute => attribute.type === "JSXAttribute" && property(attribute.name) === "disabled")
          : node.type === "CallExpression" && node.arguments[1]?.type === "ObjectExpression"
            && node.arguments[1].properties.some(item => item.type === "Property" && (item.computed ? reference(item.key, scope, new Set()) === "literal:disabled" : property(item.key) === "disabled"))
        if (disabled) failures.push(`${owner}: fieldsets group controls; disable individual edit controls`)
      }
      if (tag === "dl" || tag === "dt" || tag === "dd") {
        let owned = factOwners.get(owner)
        if (owned === undefined) { owned = new Set(); factOwners.set(owner, owned) }
        owned.add(tag)
      }
    }
  }
  if (factOwners.size !== 1) failures.push(`native fact rows have ${factOwners.size} owners (${[...factOwners.keys()].join(", ")}); use the shared row`)
  for (const [owner, tags] of factOwners) if (tags.size !== 3) failures.push(`${owner}: native fact tags must share their row owner`)
  if (clipboardOwners.size !== 1) failures.push(`clipboard access has ${clipboardOwners.size} owners (${[...clipboardOwners].join(", ")}); use the shared value component`)
  return failures
}

const rowOwner: Source = { name: "rows.tsx", text: "export function Row(){return <dl><dt>Label</dt><dd>Value</dd></dl>}" }
const copyOwner: Source = { name: "copy.ts", text: "export async function copy(value:string){await navigator.clipboard.writeText(value)}" }

test("production UI source has one native fact markup owner and one browser clipboard owner", () => {
  const directory = new URL("../src/", import.meta.url)
  const sources = readdirSync(directory, { recursive: true }).filter(name => typeof name === "string" && /\.tsx?$/.test(name)).map(name => ({ name: String(name), text: readFileSync(new URL(String(name), directory), "utf8") }))
  assert.deepEqual(ownershipFailures(sources), [])
})

test("source ownership accepts consumers and rejects independent JSX, aliased API and computed-property bypasses", () => {
  assert.deepEqual(ownershipFailures([rowOwner, copyOwner, { name: "consumer.tsx", text: "import {Row as Fact} from './rows'; export const display=<Fact/>" }]), [])
  assert.deepEqual(ownershipFailures([rowOwner, copyOwner, { name: "locals.tsx", text: "import {createElement as h} from 'react'; function unrelated(){const n={clipboard:1};return n.clipboard} function shadowed(h:Function,navigator:{clipboard:number}){return [h('dd'),navigator.clipboard]} function dynamic(clipboard:string){return navigator[clipboard]} function caught(){try{}catch(navigator){return navigator.clipboard}} function hoisted(){for(var navigator of []){}return navigator.clipboard}" }]), [], "unrelated local bindings and dynamic keys are not mistaken for native capabilities")
  for (const text of [
    "export const blocked=<fieldset disabled><button>Copy</button></fieldset>",
    "import {createElement as h} from 'react'; export const blocked=h('fieldset',{disabled:true})",
    "import * as R from 'react'; const key='disabled';export const blocked=R['createElement']('fieldset',{[key]:true})",
    "export function Inline(){return <dl><dt>Other</dt><dd>Value</dd></dl>}",
    "import {createElement as h} from 'react';export const duplicate=h('dt',null,'Other')",
    "import * as R from 'react'; export const duplicate=R['createElement']('dd',null,'Value')",
    "import {createElement as h} from 'react'; const tag='dd'; export const duplicate=h(tag,null,'Value')",
    "export function unrelated(){const n=globalThis['navigator'];const {clipboard:c}=n;return c.writeText('other')}",
    "export function nested(){const {clipboard:{writeText:write}}=navigator;return write('other')}",
    "export function nested(){const {navigator:{clipboard:{readText:read}}}=globalThis;return read()}",
    "export function typed(){return (navigator as Navigator).clipboard}",
    "export function nonnull(){return navigator!.clipboard}",
    "export function checked(){return (navigator satisfies Navigator).clipboard}",
    "export function afterLoop(){for(let navigator of []){}return navigator.clipboard}",
    "export function legacy(){return document['execCommand']('copy')}",
    "export function legacy(){return window.document.execCommand('copy')}",
  ]) assert.notDeepEqual(ownershipFailures([rowOwner, copyOwner, { name: "new-consumer.tsx", text }]), [], text)
  assert.notDeepEqual(ownershipFailures([rowOwner, copyOwner, { name: "broken.tsx", text: "export const broken=<div" }]), [], "parse errors cannot silently skip the check")
})
