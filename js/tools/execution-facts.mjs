// Native TypeScript facts only. Roles, graph traversal and permissions belong to Go.
import { createHash } from "node:crypto"
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as ast from "typescript/unstable/ast"
import { API, SymbolFlags, TypeFlags } from "typescript/unstable/sync"

const digest = bytes => createHash("sha256").update(bytes).digest("hex")
const moduleCapabilities = new Map([
  ["child_process", "process-launch"], ["cluster", "process-launch"],
  ["process", "process-object"], ["module", "runtime-loader"],
])

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

async function readRequest() {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 4 * 1024 * 1024) throw new Error("analysis request exceeds 4 MiB")
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function collectFacts(request, requestBytes) {
  if (request.protocol !== 1) throw new Error("unsupported analysis request protocol")
  const analyzerSHA256 = digest(readFileSync(fileURLToPath(import.meta.url)))
  const compilerVersion = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("typescript/package.json")), "utf8")).version
  if (analyzerSHA256 !== request.analyzerSHA256 || compilerVersion !== request.compilerVersion) {
    throw new Error("requested analyzer/compiler identity differs from installed tools")
  }
  const texts = new Map(request.sources.map(source => {
    const file = resolve(request.root, source.path)
    const bytes = readFileSync(file)
    if (digest(bytes) !== source.sha256) throw new Error(`source changed before analysis: ${source.path}`)
    return [file, bytes.toString("utf8")]
  }))
  const directory = mkdtempSync(join(tmpdir(), "cam-native-facts-"))
  const config = join(directory, "tsconfig.json")
  writeFileSync(config, JSON.stringify({ extends: request.config, files: [...texts.keys()], include: [], compilerOptions: { allowJs: true } }))
  const api = new API({ cwd: dirname(request.config), fs: { readFile: file => texts.get(file) } })
  let snapshot
  try {
    snapshot = api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config)
    if (!project) throw new Error("native compiler did not load the assigned source project")
    const { program, checker } = project
    const globals = Object.fromEntries(["process", "require", "module"].map(name => {
      const symbol = checker.resolveName(name, SymbolFlags.Value)
      if (!symbol) throw new Error(`native Node symbol unavailable: ${name}`)
      return [name, symbol.id]
    }))
    const modules = request.sources.map(assigned => {
      const file = resolve(request.root, assigned.path)
      const source = program.getSourceFile(file)
      if (!source || source.text !== texts.get(file)) throw new Error(`native source cohort differs: ${assigned.path}`)
      if (program.getSyntacticDiagnostics(file).length) throw new Error(`invalid TypeScript: ${assigned.path}`)
      const facts = { path: assigned.path, sha256: digest(source.text), dependencies: [], uses: [] }
      const line = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const use = (node, capability, member = "") => facts.uses.push({ capability, member, line: line(node) })
      const dependency = (node, literal) => {
        const specifier = literal.text
        const capability = moduleCapabilities.get(specifier.replace(/^node:/, ""))
        if (capability) use(node, capability)
        const symbol = checker.getSymbolAtLocation(literal)
        const declarations = [...new Set(symbol?.declarations.map(declaration => declaration.path) ?? [])]
        let target = ""
        let resolved = false
        if (declarations.length === 1) { target = declarations[0]; resolved = true }
        else if (specifier.startsWith(".")) {
          // Explicit file imports may be side-effect scripts without a module symbol.
          target = resolve(dirname(file), specifier)
          resolved = program.getSourceFile(target) !== undefined
        }
        facts.dependencies.push({ specifier, target: target ? relative(request.root, target).replaceAll("\\", "/") : "", resolved, line: line(node) })
      }
      const visit = node => {
        if ((ast.isImportDeclaration(node) || ast.isExportDeclaration(node)) && node.moduleSpecifier) {
          dependency(node, node.moduleSpecifier)
        } else if (ast.isImportTypeNode(node) && ast.isLiteralTypeNode(node.argument) && ast.isStringLiteral(node.argument.literal)) {
          dependency(node, node.argument.literal)
        } else if (ast.isImportEqualsDeclaration(node) || (ast.isCallExpression(node) && node.expression.kind === ast.SyntaxKind.ImportKeyword)) {
          use(node, "runtime-loader")
        }
        const symbol = referencedGlobal(node, checker)
        if (symbol?.id === globals.require || symbol?.id === globals.module) use(node, "runtime-loader")
        else if (symbol?.id === globals.process) {
          const parent = node.parent
          const member = ast.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text : ""
          use(node, "process-object", member)
        }
        node.forEachChild(visit)
      }
      visit(source)
      return facts
    })
    return { protocol: 1, requestSHA256: digest(requestBytes), analyzerSHA256, compilerVersion, modules }
  } finally {
    snapshot?.dispose()
    api.close()
    rmSync(directory, { recursive: true, force: true })
  }
}

try {
  const bytes = await readRequest()
  process.stdout.write(JSON.stringify(collectFacts(JSON.parse(bytes), bytes)) + "\n")
} catch (error) {
  process.stderr.write(`Cannot extract native execution facts: ${error.message}\n`)
  process.exitCode = 1
}
