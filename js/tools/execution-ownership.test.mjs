import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve, sep } from "node:path"
import test from "node:test"
import * as ast from "typescript/unstable/ast"
import { API, SymbolFlags, TypeFlags } from "typescript/unstable/sync"

const workspace = process.cwd()
const forbiddenModules = new Set(["child_process", "cluster", "process", "module"])
const packageOutputs = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")).workspaces
  .filter(path => path.startsWith("packages/"))
  .map(path => join(workspace, path, "dist") + sep)

function operationCores(tools) {
  // These filenames declare the same core role in every tool directory.
  return readdirSync(tools, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => ["core.ts", "shared.ts", "reference.ts", "protocol.ts", "config.ts"].map(name => join(tools, entry.name, name)))
    .filter(existsSync)
    .sort()
}

function testDependency(path) {
  return /(?:^|\/)(?:tests?|fixtures|(?:[^/]+-)?(?:rehearsal|scenario))(?:\/|$)/.test(path)
    || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
}

function referencedGlobal(node, checker) {
  if (ast.isElementAccessExpression(node)) {
    const key = checker.getTypeAtLocation(node.argumentExpression)
    if (key.flags & TypeFlags.StringLiteral) {
      return checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), key.value)
    }
  } else if ((ast.isIdentifier(node) && ["process", "require", "module"].includes(node.text)
      && !(ast.isPropertyAccessExpression(node.parent) && node.parent.name === node))
      || (ast.isPropertyAccessExpression(node) && ["process", "require", "module"].includes(node.name.text))) {
    return checker.getSymbolAtLocation(node)
  }
}

// The native compiler owns parsing and symbol identity. This check follows only
// local source edges; dependency-package internals are outside its claim.
function ownershipIssues(roots, localRoot = join(workspace, "tools")) {
  assert(roots.length > 0, "operation core discovery must not be empty")
  const directory = mkdtempSync(join(tmpdir(), "cam-execution-ownership-"))
  const config = join(directory, "tsconfig.json")
  writeFileSync(config, JSON.stringify({ extends: join(workspace, "tsconfig.tool.json"), files: roots, include: [] }))
  const api = new API({ cwd: workspace })
  let snapshot
  try {
    snapshot = api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config)
    assert(project, "compiler must load the ownership-check project")
    const { program, checker } = project
    const processSymbol = checker.resolveName("process", SymbolFlags.Value)
    const requireSymbol = checker.resolveName("require", SymbolFlags.Value)
    const moduleSymbol = checker.resolveName("module", SymbolFlags.Value)
    assert(processSymbol, "Node process identity must be available for ownership analysis")
    assert(requireSymbol, "Node require identity must be available for ownership analysis")
    assert(moduleSymbol, "Node module identity must be available for ownership analysis")
    const issues = []
    const seen = new Set()
    const pending = [...roots]
    while (pending.length) {
      const file = pending.pop()
      if (seen.has(file)) continue
      seen.add(file)
      const source = program.getSourceFile(file)
      assert(source, `cannot analyze operation dependency ${file}`)
      assert.equal(program.getSyntacticDiagnostics(file).length, 0, `cannot analyze invalid TypeScript: ${file}`)
      const report = (node, message) => {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        issues.push(`${relative(workspace, file)}:${line}: ${message}`)
      }
      const dependency = (node, specifier) => {
        if (forbiddenModules.has(specifier.replace(/^node:/, ""))) {
          report(node, `operation cores cannot import ${specifier}; inputs and process launches belong to adapters`)
        } else if (testDependency(specifier)) {
          report(node, `operation cores cannot depend on test/fixture driver ${specifier}`)
        } else if (specifier.startsWith("/") || specifier.startsWith("file:") || specifier.startsWith("#")) {
          report(node, `operation cores cannot analyze non-relative local dependency ${specifier}`)
        } else if (specifier.startsWith(".")) {
          const target = resolve(dirname(file), specifier)
          // Built workspace packages own their dependency boundaries.
          if (!packageOutputs.some(output => target.startsWith(output))) {
            assert(target.startsWith(localRoot + sep), `operation dependency escapes its source boundary: ${file}: ${specifier}`)
            if (/(?:^|\/)(?:main|runner)\.ts$/.test(target)) {
              report(node, `operation cores cannot depend on entrypoint adapter ${specifier}`)
            } else pending.push(target)
          }
        }
      }
      const visit = node => {
        if ((ast.isImportDeclaration(node) || ast.isExportDeclaration(node)) && node.moduleSpecifier) {
          dependency(node, node.moduleSpecifier.text)
        } else if (ast.isImportTypeNode(node) && ast.isLiteralTypeNode(node.argument)
            && ast.isStringLiteral(node.argument.literal)) {
          dependency(node, node.argument.literal.text)
        } else if (ast.isImportEqualsDeclaration(node)
            || (ast.isCallExpression(node) && node.expression.kind === ast.SyntaxKind.ImportKeyword)) {
          report(node, "operation cores require static ESM dependencies; runtime module loading is not analyzed")
        }
        const symbol = referencedGlobal(node, checker)
        if (symbol?.id === requireSymbol.id || symbol?.id === moduleSymbol.id) {
          report(node, "operation cores require static ESM dependencies; runtime module loading is not analyzed")
        } else if (symbol?.id === processSymbol.id) {
          const parent = node.parent
          // Diagnostic wrappers report failures without obtaining their inputs here.
          const diagnostic = ast.isPropertyAccessExpression(parent) && parent.expression === node
            && ["stderr", "exitCode"].includes(parent.name.text)
          if (!diagnostic) report(node, "operation cores must receive explicit inputs; ambient process access/aliasing belongs to entrypoints")
        }
        node.forEachChild(visit)
      }
      visit(source)
    }
    return issues.sort()
  } finally {
    snapshot?.dispose()
    api.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

function example(files) {
  const directory = mkdtempSync(join(tmpdir(), "cam-ownership-example-"))
  try {
    for (const [name, source] of Object.entries(files)) {
      const file = join(directory, name)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, source)
    }
    return ownershipIssues([join(directory, "shared.ts")], directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test("operation cores and their local dependencies retain explicit inputs and execution ownership", () => {
  assert.deepEqual(ownershipIssues(operationCores(join(workspace, "tools"))), [])
})

test("injected inputs, local dependencies, diagnostic output and harmless text are allowed", () => {
  assert.deepEqual(example({
    "shared.ts": `import { choose } from "./values.ts"
      export function plan(inputs: { env: string; argv: string[] }) {
        // process.env, require('node:child_process')
        process.stderr.write("process.argv is not an input here")
        process.exitCode = 1
        return choose(inputs.env, inputs.argv)
      }`,
    "values.ts": "export function choose(env: string, argv: string[]) { return [env, argv] }",
  }), [])
})

for (const source of [
  "export const input = process.env.CHAIN",
  "export const input = process['argv']",
  "const runtime = process; export const input = runtime.env",
  "const { env: settings } = process; export { settings }",
  "export const input = globalThis.process.env",
  "export const input = globalThis['process'].env",
  "const key = 'process'; export const input = globalThis[key].env",
  "import runtime from 'node:process'; export const input = runtime.env",
  "import { env as settings } from 'process'; export { settings }",
]) {
  test(`ambient input is rejected: ${source}`, () => {
    assert(example({ "shared.ts": source }).some(issue => /explicit inputs|cannot import/.test(issue)))
  })
}

for (const source of [
  "import { spawn as launch } from 'node:child_process'; export { launch }",
  "export { fork } from 'child_process'",
  "import * as workers from 'node:cluster'; export { workers }",
  "export { helper } from './helper.test.ts'",
  "export { helper } from './fixtures/helper.ts'",
  "export { helper } from './example-scenario/workload.ts'",
  "export const helper = import('./helper.ts')",
  "export const helper = import(process.env.MODULE!)",
  "const load = require; export const helper = load('./helper.ts')",
  "export const helper = module.require('child_process')",
  "export const helper = globalThis['require']('child_process')",
  "import load = require('node:child_process'); export { load }",
]) {
  test(`execution/driver dependency is rejected: ${source}`, () => {
    assert(example({ "shared.ts": source, "helper.ts": "export const helper = 1" })
      .some(issue => /cannot import|cannot depend|static ESM/.test(issue)))
  })
}

test("a re-export cannot hide ambient inputs in a transitive local dependency", () => {
  const issues = example({
    "shared.ts": "export { plan } from './policy.ts'",
    "policy.ts": "export { plan } from './input.ts'",
    "input.ts": "export const plan = process.env.PLAN",
  })
  assert.equal(issues.length, 1)
  assert.match(issues[0], /input\.ts:1:.*explicit inputs/)
})

for (const entrypoint of ["main.ts", "runner.ts"]) {
  test(`core dependencies cannot reach ${entrypoint}, even without ambient reads or launches`, () => {
    const issues = example({
      "shared.ts": "export { plan } from './policy.ts'",
      "policy.ts": `export { plan } from './${entrypoint}'`,
      [entrypoint]: "export const plan = 1",
    })
    assert.equal(issues.length, 1)
    assert.match(issues[0], /policy\.ts:1:.*cannot depend on entrypoint adapter/)
  })
}

test("a locally named process input is not mistaken for the Node global", () => {
  assert.deepEqual(example({
    "shared.ts": "export function plan(process: { env: string }) { return process.env }",
  }), [])
})

test("require is allowed as an explicit input or ordinary property", () => {
  assert.deepEqual(example({
    "shared.ts": "export function plan(require: string, module: string, inputs: { require: boolean }) { return [require, module, inputs.require] }",
  }), [])
})

for (const specifier of ["/tmp/local-policy.ts", "file:///tmp/local-policy.ts", "#local-policy"]) {
  test(`non-relative local dependency is rejected: ${specifier}`, () => {
    assert(example({ "shared.ts": `export { plan } from '${specifier}'` })
      .some(issue => /non-relative local dependency/.test(issue)))
  })
}

test("invalid source cannot produce a clean ownership report", () => {
  assert.throws(() => example({ "shared.ts": "export const = ;" }), /invalid TypeScript/)
})

test("operation roles are discovered independently of directory or application names", () => {
  const directory = mkdtempSync(join(tmpdir(), "cam-ownership-discovery-"))
  try {
    mkdirSync(join(directory, "arbitrary-tool"))
    const cores = ["config.ts", "core.ts", "protocol.ts", "reference.ts", "shared.ts"]
      .map(name => join(directory, "arbitrary-tool", name))
    for (const file of [...cores, join(directory, "arbitrary-tool/runner.ts")]) {
      writeFileSync(file, "export const value = 1")
    }
    assert.deepEqual(operationCores(directory), cores)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
