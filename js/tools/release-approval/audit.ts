import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readdirSync, realpathSync, writeSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import type { Audit, AuditEvent } from "./owner.ts"

export function openAudit(directory: string): Audit & { close(): void } {
  if (!isAbsolute(directory) || realpathSync(directory) !== resolve(directory)) {
    throw new Error("Approval audit directory must be an absolute, resolved path")
  }
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error("Approval audit directory must be owner-only")
  }
  if (readdirSync(directory).length !== 0) throw new Error("Approval audit directory has already been used")

  const filename = join(directory, "approval.jsonl")
  const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_APPEND, 0o600)
  let closed = false
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Approval audit is not a regular file")
    fsyncSync(fd)
    const parent = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try { fsyncSync(parent) } finally { closeSync(parent) }
  } catch (error) { closeSync(fd); throw error }

  return {
    append(event: AuditEvent) {
      if (closed) throw new Error("Approval audit is closed")
      const bytes = Buffer.from(JSON.stringify(event) + "\n")
      let written = 0
      while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written)
      fsyncSync(fd)
    },
    close() { if (!closed) { closed = true; closeSync(fd) } },
  }
}
