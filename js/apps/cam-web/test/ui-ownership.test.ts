import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { parseSync, type ESTree } from "vite"

type Source = { readonly name: string; readonly text: string }
type Binding = { readonly scope: Scope; readonly expression: ESTree.Node; readonly constant: boolean; readonly member?: string } | string | undefined
type Scope = { readonly parent: Scope | undefined; readonly bindings: Map<string, Binding>; readonly kind: "module" | "function" | "block" }
type LocatedNode = { readonly node: ESTree.Node; readonly owner: string; readonly scope: Scope; readonly ancestors: readonly ESTree.Node[] }

function property(node: ESTree.Node): string | undefined {
  if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name
  if (node.type === "Literal" && typeof node.value === "string") return node.value
  return undefined
}

function bind(pattern: ESTree.Node, scope: Scope, expression: ESTree.Node | undefined, evaluation: Scope, constant: boolean, member?: string): void {
  if (pattern.type === "Identifier") {
    scope.bindings.set(pattern.name, expression === undefined ? undefined : { scope: evaluation, expression, constant, ...(member === undefined ? {} : { member }) })
  } else if (pattern.type === "ObjectPattern") {
    for (const item of pattern.properties) if (item.type === "Property") {
      const key = property(item.key)
      bind(item.value, scope, expression, evaluation, constant, member === undefined ? key : key === undefined ? undefined : `${member}.${key}`)
    }
  } else if (pattern.type === "ArrayPattern") {
    for (const item of pattern.elements) if (item !== null) bind(item, scope, undefined, evaluation, false)
  } else if (pattern.type === "AssignmentPattern") bind(pattern.left, scope, expression, evaluation, constant, member)
  else if (pattern.type === "RestElement") bind(pattern.argument, scope, undefined, evaluation, false)
}

function* walk(value: unknown, owner: string, enclosing: Scope, ancestors: readonly ESTree.Node[]): Generator<LocatedNode> {
  if (value === null || typeof value !== "object") return
  if (Array.isArray(value)) { for (const child of value) yield* walk(child, owner, enclosing, ancestors); return }
  if (!("type" in value)) return
  const node = value as ESTree.Node
  let scope = enclosing
  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    ancestors = []
    scope = { parent: enclosing, bindings: new Map(), kind: "function" }
    owner = `${owner}@${node.start}`
    if (node.type === "FunctionDeclaration" && node.id !== null) enclosing.bindings.set(node.id.name, undefined)
    for (const parameter of node.params) bind(parameter, scope, undefined, scope, false)
  } else if (node.type === "BlockStatement" || node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement" || node.type === "CatchClause") {
    scope = { parent: enclosing, bindings: new Map(), kind: "block" }
    if (node.type === "CatchClause" && node.param !== null) bind(node.param, scope, undefined, scope, false)
  }
  if (node.type === "VariableDeclaration") {
    let declaring = scope
    if (node.kind === "var") while (declaring.kind === "block" && declaring.parent !== undefined) declaring = declaring.parent
    for (const declaration of node.declarations) bind(declaration.id, declaring, declaration.init === null ? undefined : declaration.init, scope, node.kind === "const")
  }
  if (node.type === "ImportDeclaration") for (const item of node.specifiers) scope.bindings.set(item.local.name, node.source.value === "react" ? item.type === "ImportSpecifier" ? `react.${property(item.imported)}` : "react" : undefined)
  yield { node, owner, scope, ancestors }
  for (const child of Object.values(node)) yield* walk(child, owner, scope, [...ancestors, node])
}

function bindingFor(scope: Scope, name: string): Binding {
  let declaring: Scope | undefined = scope
  while (declaring !== undefined && !declaring.bindings.has(name)) declaring = declaring.parent
  return declaring?.bindings.get(name)
}

function reference(node: ESTree.Node, scope: Scope, seen: Set<Binding>): string | undefined {
  if (node.type === "Identifier") {
    const binding = bindingFor(scope, node.name)
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

function nativeTag(node: ESTree.Node, scope: Scope): string | undefined {
  if (node.type === "JSXElement") return nativeTag(node.openingElement, scope)
  if (node.type === "JSXOpeningElement" && node.name.type === "JSXIdentifier") return node.name.name
  if (node.type !== "CallExpression" || reference(node.callee, scope, new Set()) !== "react.createElement" || node.arguments[0] === undefined) return undefined
  const tag = reference(node.arguments[0], scope, new Set())
  return tag?.startsWith("literal:") ? tag.slice(8) : undefined
}

function elementValue(node: ESTree.Node, name: string, scope: Scope): ESTree.Node | undefined {
  if (node.type === "JSXElement") return elementValue(node.openingElement, name, scope)
  let value: ESTree.Node | undefined
  if (node.type === "JSXOpeningElement") {
    const attribute = node.attributes.find(item => item.type === "JSXAttribute" && property(item.name) === name)
    if (attribute?.type === "JSXAttribute" && attribute.value !== null) value = attribute.value.type === "JSXExpressionContainer" ? attribute.value.expression : attribute.value
  } else if (node.type === "CallExpression" && node.arguments[1]?.type === "ObjectExpression") {
    const attribute = node.arguments[1].properties.find(item => item.type === "Property" && (item.computed ? reference(item.key, scope, new Set()) === `literal:${name}` : property(item.key) === name))
    if (attribute?.type === "Property") value = attribute.value
  }
  return value
}

function elementProperty(node: ESTree.Node, name: string, scope: Scope): string | undefined {
  const value = elementValue(node, name, scope)
  const resolved = value === undefined ? undefined : reference(value, scope, new Set())
  return resolved?.startsWith("literal:") ? resolved.slice(8) : undefined
}

function elementChildren(node: ESTree.Node, scope: Scope): readonly ESTree.Node[] {
  if (node.type === "JSXElement") {
    const children = node.children.filter(child => {
      if (child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression") return false
      if (child.type === "JSXText" && /[\r\n]/u.test(child.value) && /^[ \t\r\n]*$/u.test(child.value)) return false
      return true
    })
    if (children.length > 0) return children
  }
  if (node.type === "CallExpression" && node.arguments.length > 2) return node.arguments.slice(2)
  const children = elementValue(node, "children", scope)
  return children === undefined ? [] : [children]
}

function staticSupportingMarkup(node: ESTree.Node, scope: Scope, seen: Set<Binding>): boolean {
  return elementValue(node, "dangerouslySetInnerHTML", scope) === undefined
    && elementChildren(node, scope).every(child => staticSupportingCopy(child, scope, seen))
}

function hasInlineProse(node: ESTree.Node, scope: Scope): boolean {
  return elementChildren(node, scope).some(child => {
    if (child.type === "JSXText") return child.value.trim() !== ""
    const expression = child.type === "JSXExpressionContainer" ? child.expression : child
    return expression.type === "Literal" ? typeof expression.value === "string" && expression.value.trim() !== ""
      : expression.type === "TemplateLiteral" && expression.quasis.some(part => Boolean(part.value.cooked?.trim()))
  })
}

function graphicalStatus(node: ESTree.Node, scope: Scope, seen: Set<Binding>): boolean {
  if (node.type === "JSXExpressionContainer") return graphicalStatus(node.expression, scope, seen)
  if (node.type === "Literal") return node.value === null
  if (node.type === "Identifier") {
    const binding = bindingFor(scope, node.name)
    if (binding === undefined || typeof binding === "string" || !binding.constant || binding.member !== undefined || seen.has(binding)) return false
    return graphicalStatus(binding.expression, binding.scope, new Set([...seen, binding]))
  }
  if (node.type === "ConditionalExpression") return graphicalStatus(node.consequent, scope, seen) && graphicalStatus(node.alternate, scope, seen)
  if (node.type === "LogicalExpression") return graphicalStatus(node.right, scope, seen)
  return node.type === "JSXElement" && elementProperty(node, "role", scope) === "img"
}

// Supporting prose accepts authored literals and local const aliases, never runtime helper execution.
function staticSupportingCopy(node: ESTree.Node, scope: Scope, seen: Set<Binding>): boolean {
  if (node.type === "Literal") {
    if (node.value === null) return true
    return ["string", "number", "boolean", "bigint"].includes(typeof node.value)
  }
  if (node.type === "JSXText" || node.type === "JSXEmptyExpression") return true
  if (node.type === "Identifier") {
    const binding = bindingFor(scope, node.name)
    if (binding === undefined || typeof binding === "string" || !binding.constant || binding.member !== undefined || seen.has(binding)) return false
    return staticSupportingCopy(binding.expression, binding.scope, new Set([...seen, binding]))
  }
  if (node.type === "ParenthesizedExpression" || node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression" || node.type === "TSNonNullExpression" || node.type === "TSTypeAssertion" || node.type === "JSXExpressionContainer") return staticSupportingCopy(node.expression, scope, seen)
  if (node.type === "JSXFragment") return node.children.every(child => staticSupportingCopy(child, scope, seen))
  if (node.type === "JSXElement") {
    const tag = nativeTag(node, scope)
    return tag !== undefined && tag[0] === tag[0]?.toLowerCase() && staticSupportingMarkup(node, scope, seen)
  }
  if (node.type === "TemplateLiteral") return node.expressions.every(child => staticSupportingCopy(child, scope, seen))
  if (node.type === "ArrayExpression") return node.elements.every(child => child === null || staticSupportingCopy(child, scope, seen))
  if (node.type === "CallExpression") return nativeTag(node, scope) !== undefined && staticSupportingMarkup(node, scope, seen)
  return false
}

function conditionalSupportingPresence(ancestors: readonly ESTree.Node[], scope: Scope): boolean {
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const parent = ancestors[index]!
    if (nativeTag(parent, scope) === "section" && elementProperty(parent, "role", scope) === "tabpanel") return false
    if (parent.type === "ConditionalExpression" || parent.type === "LogicalExpression") return true
  }
  return false
}

// A whole field may be conditional, but commentary within an existing field
// must not appear as its state changes. Buttons and hidden descriptions own
// their own state; Feedback owns actual operation failures.
function fieldCommentary(ancestors: readonly ESTree.Node[], scope: Scope, conditional: boolean): boolean {
  for (let index = ancestors.length - 1; index >= 0; index--) {
    const ancestor = ancestors[index]!
    const tag = nativeTag(ancestor, scope)
    const className = elementProperty(ancestor, "className", scope)
    const classes = className === undefined ? [] : className.split(/\s+/u)
    if (tag === "button" || classes.includes("visually-hidden")) return false
    if (tag === "section" && elementProperty(ancestor, "role", scope) === "tabpanel") return false
    if (tag === "label" || tag === "fieldset") return conditional
    if (ancestor.type === "ConditionalExpression" || ancestor.type === "LogicalExpression") conditional = true
  }
  return false
}

function conditionalText(node: ESTree.Node): boolean {
  function containsText(value: ESTree.Node): boolean {
    if (value.type === "Literal") return typeof value.value === "string" && value.value.trim() !== ""
    if (value.type === "TemplateLiteral") return value.quasis.some(part => Boolean(part.value.cooked?.trim()))
    if (value.type === "ConditionalExpression") return containsText(value.consequent) || containsText(value.alternate)
    if (value.type === "LogicalExpression") return containsText(value.right)
    return false
  }
  return (node.type === "ConditionalExpression" || node.type === "LogicalExpression") && containsText(node)
}

function appearingText(node: ESTree.Node): boolean {
  if (node.type === "LogicalExpression") return conditionalText(node)
  if (node.type !== "ConditionalExpression" || !conditionalText(node)) return false
  return [node.consequent, node.alternate].some(branch => branch.type === "Literal" && (branch.value === null || branch.value === "" || branch.value === false))
}

// This is a source ownership check for statically named JSX and browser APIs,
// not an interpreter for dynamic React construction or a JavaScript sandbox.
// Supporting-copy rules cover declared helper classes, not dynamically constructed roles.
function ownershipFailures(sources: readonly Source[]): string[] {
  const failures: string[] = []
  const factOwners = new Map<string, Set<string>>()
  const clipboardOwners = new Set<string>()
  for (const { name, text } of sources) {
    const parsed = parseSync(name, text)
    if (parsed.errors.length !== 0) { failures.push(`${name}: cannot check invalid source`); continue }
    const globals: Scope = { parent: undefined, bindings: new Map(["navigator", "window", "globalThis", "document"].map(name => [name, name])), kind: "module" }
    const module: Scope = { parent: globals, bindings: new Map(), kind: "module" }
    const nodes = [...walk(parsed.program, name, module, [])]
    for (const { node, owner, scope, ancestors } of nodes) {
      const path = reference(node, scope, new Set())
      if (["navigator.clipboard", "window.navigator.clipboard", "globalThis.navigator.clipboard"].some(base => path === base || path?.startsWith(`${base}.`))) clipboardOwners.add(owner)
      const tag = node.type === "JSXElement" ? undefined : nativeTag(node, scope)
      if (node.type === "CallExpression") {
        const callee = reference(node.callee, scope, new Set())
        if ((callee === "document.execCommand" || callee === "window.document.execCommand" || callee === "globalThis.document.execCommand") && node.arguments[0] !== undefined && property(node.arguments[0]) === "copy") failures.push(`${owner}: legacy clipboard copy bypasses the shared owner`)
      }
      if (tag === "p") {
        const classes = elementProperty(node, "className", scope)?.split(/\s+/u)
        if (classes !== undefined && !classes.includes("visually-hidden") && classes.some(name => name === "field-hint" || name === "field-error")) {
          const parent = ancestors.at(-1)
          const element = node.type === "CallExpression" ? node : parent?.type === "JSXElement" ? parent : node
          if (conditionalSupportingPresence(ancestors, scope) || !staticSupportingMarkup(element, scope, new Set())) failures.push(`${owner}: visible supporting prose must be static within its view; use accessible descriptions, shared feedback or value rows`)
        }
      }
      if (tag !== undefined && ["p", "span", "small", "output", "div"].includes(tag)) {
        const classes = elementProperty(node, "className", scope)?.split(/\s+/u)
        const editor = ancestors.some(ancestor => {
          const enclosingTag = nativeTag(ancestor, scope)
          return enclosingTag === "dialog" || enclosingTag === "form" || enclosingTag === "fieldset" || elementProperty(ancestor, "role", scope) === "dialog"
        })
        const owned = ancestors.some(ancestor => {
          const name = nativeTag(ancestor, scope)
          return name !== undefined && ["button", "label", "PropertyRow"].includes(name)
        })
        const parent = ancestors.at(-1)
        const element = node.type === "CallExpression" ? node : parent?.type === "JSXElement" ? parent : node
        const conditional = elementChildren(element, scope).some(child => conditionalText(child.type === "JSXExpressionContainer" ? child.expression : child))
        const liveMode = elementProperty(node, "aria-live", scope)
        const children = elementChildren(element, scope)
        const graphical = children.length > 0 && children.every(child => graphicalStatus(child, scope, new Set()))
        const status = (elementProperty(node, "role", scope) === "status" || liveMode === "polite" || liveMode === "assertive") && !graphical
        const measurement = tag === "output" && liveMode === "off"
        if (editor && !owned && !graphical && !measurement && !classes?.includes("visually-hidden") && elementProperty(node, "role", scope) !== "alert" && (tag !== "div" || status || conditional || hasInlineProse(element, scope)) && !staticSupportingMarkup(element, scope, new Set())) {
          failures.push(`${owner}: editor commentary must not change with input state; use an owned value control or feedback`)
        }
      }
      if (tag !== undefined && ["p", "span", "small", "output"].includes(tag)) {
        const className = elementProperty(node, "className", scope)
        const classes = className === undefined ? [] : className.split(/\s+/u)
        const element = node.type === "CallExpression" ? node : ancestors.at(-1)
        const liveMode = elementProperty(node, "aria-live", scope)
        const live = elementProperty(node, "role", scope) === "status" || liveMode === "polite" || liveMode === "assertive"
        const changesStatus = live && element !== undefined && elementChildren(element, scope).some(child => {
          const expression = child.type === "JSXExpressionContainer" ? child.expression : child
          return expression.type === "ConditionalExpression" || expression.type === "LogicalExpression"
        })
        if (!classes.includes("visually-hidden") && fieldCommentary(ancestors, scope, changesStatus)) failures.push(`${owner}: field commentary must not appear conditionally; use the control or an accessible description`)
      }
      if (node.type === "JSXExpressionContainer" && node.expression.type !== "JSXEmptyExpression" && conditionalText(node.expression)) {
        const parent = ancestors.at(-1)
        const tag = parent === undefined ? undefined : nativeTag(parent, scope)
        const directText = tag !== undefined && ["label", "fieldset", "div"].includes(tag)
        const appearing = tag !== undefined && ["p", "span", "small", "output"].includes(tag) && appearingText(node.expression)
        if ((directText || appearing) && fieldCommentary(ancestors, scope, true)) failures.push(`${owner}: field commentary must not appear conditionally; use the control or an accessible description`)
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

test("supporting prose is static within its view while causes, facts and task content retain their owners", () => {
  for (const text of [
    "export const help=<p className='field-hint'>Use the document URL.</p>",
    "const copy='Use the URL.';const alias=copy;export const help=<p className='field-hint'>{alias}<code>https</code></p>",
    "export function help(bad:boolean){return bad?<p className='field-hint visually-hidden'>{bad?'Invalid':'Valid'}</p>:null}",
    "export function pane(selected:boolean){return selected?<section role='tabpanel'><p className='field-hint'>Store this JSON on chain.</p></section>:null}",
    "import {createElement as h} from 'react';export const help=h('p',{className:'field-hint',children:'Use the URL.'})",
    "export const help=<p className='field-hint'><span children='Use the URL.'/></p>",
    "export function help(status:string){return <p className='field-hint' children={messageFor(status)}>{' '}</p>}",
    "export function content(show:boolean,value:string){return <>{show?<p className='nft-placeholder'>NFT preview</p>:<p>{value}</p>}{show?<PropertyRow label='Total' value={value}/>:<Feedback report={value}/>}</>}",
    "export function editor(value:number){return <dialog><textarea/><p>Content may be public.</p><meter value={value} max={100}/></dialog>}",
    "export function editor(error:string){return <form><input/><p role='alert'>{error}</p></form>}",
    "export function editor(value:number){return <dialog><textarea/><output aria-live='off'>{value} / 512</output></dialog>}",
    "export function editor(checked:boolean){const icon=checked?<span role='img' aria-label='Checked'>✓</span>:null;return <form><input/><span role='status'>{icon}</span></form>}",
  ]) assert.deepEqual(ownershipFailures([rowOwner, copyOwner, { name: "help.tsx", text }]), [], text)
  for (const text of [
    "export function bad(invalid:boolean){return invalid?<p className='field-hint'>Correct it.</p>:null}",
    "export function bad(invalid:boolean){return invalid&&<div><p className='field-error'>Correct it.</p></div>}",
    "export function bad(invalid:boolean){const explanation=invalid?'Correct it.':'Ready.';return <p className='field-hint'>{explanation}</p>}",
    "export function bad(invalid:boolean){const explanation=invalid?'Correct it.':'Ready.';const alias=explanation;return <p className='field-hint'><strong>{alias}</strong></p>}",
    "export function bad(status:string){const explanation=messageFor(status);return <p className='field-hint'>{explanation}</p>}",
    "import {createElement as h} from 'react';export function bad(state:boolean){return h('p',{className:'field-hint'},state?'Correct it.':'Ready.')}",
    "export function bad(status:string){return <p className='field-hint' children={messageFor(status)}/>}",
    "export function bad(status:string){return <p className='field-hint'><span children={messageFor(status)}/></p>}",
    "import {createElement as h} from 'react';export function bad(status:string){return h('p',{className:'field-hint',children:messageFor(status)})}",
    "import {createElement as h} from 'react';const key='className';export function bad(state:boolean){return h('p',{[key]:'field-hint'},state?'Correct it.':'Ready.')}",
    "export function bad(status:string){return <p className='field-hint'><span dangerouslySetInnerHTML={{__html:messageFor(status)}}/></p>}",
    "export function bad(status:string){return <p className='field-hint' dangerouslySetInnerHTML={{__html:messageFor(status)}}/>}",
    "import {createElement as h} from 'react';export function bad(status:string){return h('p',{className:'field-hint'},h('span',{dangerouslySetInnerHTML:{__html:messageFor(status)}}))}",
    "export function bad(status:string){return <p className='field-hint' children={messageFor(status)}>{/* comment */}</p>}",
    "export function bad(status:string){return <p className='field-hint' children={messageFor(status)}>\n  </p>}",
    "export function bad(status:string){return <p className='field-hint' children={messageFor(status)}>{/* comment */}\n  </p>}",
    "export function bad(selected:boolean,invalid:boolean){return selected?<section role='tabpanel'>{invalid?<p className='field-hint'>Correct it.</p>:null}</section>:null}",
    "export function editor(value:number){return <dialog><textarea/><p>Used: {value} bytes</p></dialog>}",
    "export function editor(value:string){return <form><input/><p>{value}</p></form>}",
    "import {createElement as h} from 'react';export function editor(value:number){return h('fieldset',null,h('input'),h('p',null,'Used: ',value))}",
    "export function editor(value:number){return <dialog><textarea/><small>Used: {value}</small></dialog>}",
    "export function editor(value:string){return <dialog><textarea/><span>{value}</span></dialog>}",
    "export function editor(value:number){return <form><input/><span>{`Remaining: ${value}`}</span></form>}",
    "export function editor(value:number){return <fieldset><input/><div>Used: {value}</div></fieldset>}",
    "export function editor(busy:boolean){return <dialog><input/><span>{busy?'Working':'Ready'}</span></dialog>}",
    "export function editor(value:string){return <dialog><textarea/><span role='status'>{value}</span></dialog>}",
  ]) assert.notDeepEqual(ownershipFailures([rowOwner, copyOwner, { name: "help.tsx", text }]), [], text)
})

test("field commentary does not appear conditionally, regardless of its tag or class", () => {
  for (const text of [
    "export function field(show:boolean){return show?<label><span>Address</span><input/></label>:null}",
    "export function field(bad:boolean){return <label><span>Address</span><input/>{bad?<span className='visually-hidden'>Invalid</span>:null}</label>}",
    "export function field(busy:boolean){return <fieldset><input/><button>{busy?<span>Checking</span>:<span>Check</span>}</button></fieldset>}",
    "export function field(bad:boolean){return <fieldset><input/>{bad?<Feedback report='Invalid'/>:null}</fieldset>}",
    "export function field(tab:boolean){return <fieldset>{tab?<section role='tabpanel'><label>URL<input/></label></section>:null}</fieldset>}",
  ]) assert.deepEqual(ownershipFailures([rowOwner, copyOwner, { name: "field.tsx", text }]), [], text)
  for (const text of [
    "export function field(bad:boolean){return <label><span>Address</span><input/>{bad?<small>Invalid</small>:null}</label>}",
    "export function field(busy:boolean){return <fieldset><input/>{busy&&<span className='different-class'>Checking</span>}</fieldset>}",
    "export function field(bad:boolean){return <fieldset><input/>{bad&&<div><output>Invalid</output></div>}</fieldset>}",
    "export function field(bad:boolean){return <label>Address<input/>{bad&&'Invalid'}</label>}",
    "export function field(bad:boolean){return <fieldset><input/><span>{bad?'Invalid':''}</span></fieldset>}",
    "export function field(busy:boolean){return <fieldset><input/><span role='status'>{busy?'Checking':''}</span></fieldset>}",
    "export function field(busy:boolean){return <fieldset><input/><span aria-live='polite'>{busy&&'Checking'}</span></fieldset>}",
    "export function field(bad:boolean){return <section role='tabpanel'><label>Address<input/>{bad&&<span>Invalid</span>}</label></section>}",
    "import {createElement as h} from 'react';export function field(bad:boolean){return h('fieldset',null,h('input'),bad?h('p',null,'Invalid'):null)}",
  ]) assert(ownershipFailures([rowOwner, copyOwner, { name: "field.tsx", text }]).some(failure => failure.includes("field commentary")), text)
})
