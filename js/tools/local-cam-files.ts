import { lstatSync, readFileSync } from "node:fs"
import { lstat, readFile, realpath } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"

import {
  assertCamResourceSize,
  assertCamSecondaryResourceURI,
  CAM_RESOURCE_MAX_BYTES,
} from "../packages/cam-protocol/dist/index.js"

type FileStat = Awaited<ReturnType<typeof lstat>>

export async function localCamResourcePath(options: {
  readonly rootPath: string
  readonly uri: string
  readonly uriLabel?: string
  readonly resourceLabel?: string
}): Promise<string> {
  const { rootPath, uri } = options
  let uriLabel = options.uriLabel
  if (uriLabel === undefined) {
    uriLabel = "local CAM resource URI"
  }
  let resourceLabel = options.resourceLabel
  if (resourceLabel === undefined) {
    resourceLabel = `local CAM resource ${uri}`
  }

  assertCamSecondaryResourceURI(uri, uriLabel)
  if (!uri.startsWith("./")) {
    throw new Error(`${uriLabel}: expected a local ./ resource URI: ${uri}`)
  }

  const rootDir = dirname(rootPath)
  return checkedContainedFilePath({
    rootDir,
    path: resolve(rootDir, uri),
    label: resourceLabel,
    boundaryLabel: "CAM directory",
  })
}

export async function checkedContainedFilePath({
  rootDir,
  path,
  label,
  boundaryLabel,
}: {
  readonly rootDir: string
  readonly path: string
  readonly label: string
  readonly boundaryLabel: string
}): Promise<string> {
  const resolvedRoot = resolve(rootDir)
  const resolvedPath = resolve(path)
  await assertDirectory(resolvedRoot, boundaryLabel)

  // Lexical containment rejects direct `..` escapes; the later realpath check
  // catches filesystem rewrites after every traversed segment has rejected
  // symlinks. Keep both checks together so local CAM file readers cannot drift.
  const relativePath = relative(resolvedRoot, resolvedPath)
  if (pathEscapesRoot(relativePath)) {
    throw new Error(`${label} must stay under ${boundaryLabel}: ${path}`)
  }

  let currentPath = resolvedRoot
  let pathStat: FileStat | undefined
  for (const segment of relativePath.split(sep)) {
    currentPath = resolve(currentPath, segment)
    pathStat = await assertExistingPath(currentPath, label)
    if (pathStat.isSymbolicLink()) {
      throw new Error(`${label} must not pass through a symlink: ${path}`)
    }
  }

  if (pathStat === undefined || !pathStat.isFile()) {
    throw new Error(`${label} must be a file: ${path}`)
  }
  assertResourceSize(pathStat.size, label)

  const realRoot = await realpath(resolvedRoot)
  const realPath = await realpath(resolvedPath)
  if (pathEscapesRoot(relative(realRoot, realPath))) {
    throw new Error(`${label} must stay under ${boundaryLabel} after resolution: ${path}`)
  }

  return resolvedPath
}

export async function assertContainedPath({
  rootPath,
  path,
  message,
}: {
  readonly rootPath: string
  readonly path: string
  readonly message: string
}): Promise<void> {
  const realRoot = await realpath(rootPath)
  const realPath = await realpath(path)
  if (pathEscapesRoot(relative(realRoot, realPath))) {
    throw new Error(`${message}: ${path}`)
  }
}

export async function assertRegularFile(path: string, label: string): Promise<FileStat> {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`)
  }
  if (!pathStat.isFile()) {
    throw new Error(`${label} must be a file: ${path}`)
  }

  return pathStat
}

export async function assertDirectory(path: string, label: string): Promise<void> {
  const pathStat = await lstat(path)
  if (pathStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`)
  }
  if (!pathStat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${path}`)
  }
}

export async function readBoundedFile(path: string, label: string): Promise<Uint8Array> {
  const pathStat = await assertRegularFile(path, label)
  assertResourceSize(pathStat.size, label)

  const bytes = await readFile(path)
  assertCamResourceSize(bytes, label)
  return bytes
}

export function readBoundedFileSync(path: string, label: string): Uint8Array {
  const pathStat = assertRegularFileSync(path, label)
  assertResourceSize(pathStat.size, label)

  const bytes = readFileSync(path)
  assertCamResourceSize(bytes, label)
  return bytes
}

async function assertExistingPath(path: string, label: string): Promise<FileStat> {
  try {
    return await lstat(path)
  } catch (cause) {
    throw new Error(`${label} does not exist: ${path}`, { cause })
  }
}

function assertRegularFileSync(path: string, label: string): FileStat {
  const pathStat = lstatSync(path)
  if (pathStat.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink: ${path}`)
  }
  if (!pathStat.isFile()) {
    throw new Error(`${label} must be a file: ${path}`)
  }

  return pathStat
}

function assertResourceSize(size: number | bigint, label: string): void {
  if (BigInt(size) > BigInt(CAM_RESOURCE_MAX_BYTES)) {
    throw new Error(`${label} is too large: exceeds ${CAM_RESOURCE_MAX_BYTES} bytes`)
  }
}

function pathEscapesRoot(path: string): boolean {
  return path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)
}
