import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const RUNTIME_SOURCES = Object.freeze([
  'tools/release-files.ts',
  'tools/release-approval/audit.ts',
  'tools/release-approval/listener.ts',
  'tools/release-approval/owner.ts',
  'tools/release-approval/reference-read.ts',
  'tools/release-approval/run.ts',
  'tools/release-approval/strict-json.ts',
  'tools/release-approval/terminal.ts',
  'tools/release-approval/verifier.ts',
])

function packageName(name) {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid locked package name: ${name}`)
  }
  return name
}

async function realEntry(path, kind) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) throw new Error(`Build input must not be a symlink: ${path}`)
  if (kind === 'file' && !stat.isFile()) throw new Error(`Build input must be a file: ${path}`)
  if (kind === 'directory' && !stat.isDirectory()) throw new Error(`Build input must be a directory: ${path}`)
}

export async function regularBelow(root, path) {
  const suffix = relative(root, path)
  if (suffix.startsWith(`..${sep}`) || suffix === '..' || suffix === '') {
    throw new Error(`Build input is outside its source directory: ${path}`)
  }
  await realEntry(root, 'directory')
  let current = root
  const parts = suffix.split(sep)
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    await realEntry(current, 'directory')
  }
  await realEntry(path, 'file')
}

async function rejectTreeSymlinks(root) {
  await realEntry(root, 'directory')
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Package input must not contain a symlink: ${path}`)
    if (entry.isDirectory()) await rejectTreeSymlinks(path)
    else if (!entry.isFile()) throw new Error(`Package input must contain only regular files: ${path}`)
  }
}

async function runtimePackages(dependencies, lock) {
  if (lock.lockfileVersion !== 3 || lock.packages === null || typeof lock.packages !== 'object') {
    throw new Error('Release image requires an npm v3 package lock')
  }
  const seen = new Set()
  const visit = async name => {
    packageName(name)
    if (seen.has(name)) return
    const locked = lock.packages[`node_modules/${name}`]
    if (!locked || typeof locked.version !== 'string') throw new Error(`Runtime package ${name} is missing from the lock`)
    const directory = join(dependencies, 'node_modules', name)
    await regularBelow(dependencies, join(directory, 'package.json'))
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    if (manifest.name !== name || manifest.version !== locked.version) {
      throw new Error(`Runtime package ${name} differs from the lock`)
    }
    await rejectTreeSymlinks(directory)
    seen.add(name)
    for (const dependency of Object.keys(locked.dependencies ?? {}).sort()) await visit(dependency)
  }
  await visit('viem')
  return [...seen].sort()
}

export async function prepareContext({ source, dependencies, image, output }) {
  source = resolve(source)
  dependencies = resolve(dependencies)
  image = resolve(image)
  output = resolve(output)
  await realEntry(output, 'directory')
  if ((await readdir(output)).length !== 0) throw new Error('Release image output directory must be empty')
  for (const name of ['Dockerfile', '.dockerignore']) await regularBelow(image, join(image, name))
  await regularBelow(source, join(source, 'package-lock.json'))
  await regularBelow(dependencies, join(dependencies, 'package-lock.json'))
  for (const name of RUNTIME_SOURCES) await regularBelow(source, join(source, name))
  const sourceLock = await readFile(join(source, 'package-lock.json'))
  const dependencyLock = await readFile(join(dependencies, 'package-lock.json'))
  if (!sourceLock.equals(dependencyLock)) throw new Error('Dependency stage lockfile differs from release source lockfile')
  const lock = JSON.parse(sourceLock.toString('utf8'))
  const packages = await runtimePackages(dependencies, lock)

  for (const name of ['Dockerfile', '.dockerignore']) await cp(join(image, name), join(output, name), { errorOnExist: true, force: false })
  await writeFile(join(output, 'package.json'), '{"private":true,"type":"module"}\n', { flag: 'wx' })
  for (const name of RUNTIME_SOURCES) {
    const destination = join(output, name)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(source, name), destination, { errorOnExist: true, force: false })
  }
  for (const name of packages) {
    const destination = join(output, 'node_modules', name)
    await mkdir(dirname(destination), { recursive: true })
    await cp(join(dependencies, 'node_modules', name), destination, { recursive: true, errorOnExist: true, force: false })
  }
  return packages
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 6) {
    process.stderr.write('Usage: prepare-context.mjs SOURCE_JS DEPENDENCY_STAGE IMAGE_DIR EMPTY_OUTPUT_DIR\n')
    process.exitCode = 2
  } else {
    prepareContext({ source: process.argv[2], dependencies: process.argv[3], image: process.argv[4], output: process.argv[5] })
      .then(packages => process.stdout.write(`Staged release approval runtime with ${packages.length} locked packages\n`))
      .catch(error => {
        process.stderr.write(`Release approval image staging failed: ${error instanceof Error ? error.message : String(error)}\n`)
        process.exitCode = 1
      })
  }
}
