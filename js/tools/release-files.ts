import { randomUUID } from "node:crypto"
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
