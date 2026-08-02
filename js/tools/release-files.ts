import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { link, lstat, open, rm } from "node:fs/promises"
import { basename, dirname, join } from "node:path"

/// Publish one new release file without replacing an existing artifact.
export async function writeNewJson(path: string, value: unknown, label: string): Promise<void> {
  await writeNewText(path, `${JSON.stringify(value, null, 2)}\n`, label)
}

export async function writeNewText(path: string, value: string, label: string): Promise<void> {
  const parent = dirname(path)
  const parentStat = await lstat(parent)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`${label} parent must be a real directory: ${parent}`)
  }
  const stage = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    const handle = await open(stage, "wx", 0o600)
    try {
      await handle.writeFile(value, { encoding: "utf-8" })
      await handle.sync()
    } finally {
      await handle.close()
    }
    await link(stage, path)
  } finally {
    await rm(stage, { force: true })
  }
  const directory = await open(parent, "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export async function readBoundedRegularFile(
  path: string,
  label: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new Error(`${label} byte limit must be a nonnegative safe integer`)
  }

  let handle
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (cause) {
    if (isNodeError(cause) && cause.code === "ELOOP") {
      throw new Error(`${label} must be a regular non-symlink file: ${path}`, { cause })
    }
    throw cause
  }

  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) {
      throw new Error(`${label} must be a regular non-symlink file: ${path}`)
    }
    if (fileStat.size > maximumBytes) {
      throw new Error(`${label} exceeds ${maximumBytes} bytes`)
    }

    const chunks: Uint8Array[] = []
    let byteLength = 0
    while (true) {
      const chunk = new Uint8Array(Math.min(64 * 1024, maximumBytes + 1 - byteLength))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength)
      if (bytesRead === 0) break

      byteLength += bytesRead
      if (byteLength > maximumBytes) {
        throw new Error(`${label} exceeds ${maximumBytes} bytes`)
      }
      chunks.push(chunk.subarray(0, bytesRead))
    }

    const bytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } finally {
    await handle.close()
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value
}
