import assert from "node:assert/strict"
import { execFile, execFileSync } from "node:child_process"
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { promisify } from "node:util"

import {
  openedFileMetadataChanged,
  readBoundedRegularFile,
  writeNewText,
} from "./release-files.ts"

const execFileAsync = promisify(execFile)

test("release file publication is no-clobber and leaves no staging file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-file-test-"))
  const path = join(directory, "deployment.json")
  try {
    await writeNewText(path, "first\n", "deployment artifact")
    assert.equal(await readFile(path, "utf-8"), "first\n")
    await assert.rejects(writeNewText(path, "second\n", "deployment artifact"))
    assert.equal(await readFile(path, "utf-8"), "first\n")
    assert.deepEqual(await readdir(directory), ["deployment.json"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("release file reads validate and bound the opened file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-file-read-test-"))
  const path = join(directory, "deployment.json")
  const linkPath = join(directory, "deployment-link.json")
  const fifoPath = join(directory, "deployment-fifo.json")
  try {
    await writeNewText(path, "12345", "deployment artifact")
    assert.deepEqual(
      await readBoundedRegularFile(path, "deployment artifact", 5),
      new TextEncoder().encode("12345"),
    )
    await assert.rejects(
      readBoundedRegularFile(path, "deployment artifact", 4),
      /deployment artifact exceeds 4 bytes/,
    )

    await symlink(path, linkPath)
    await assert.rejects(
      readBoundedRegularFile(linkPath, "deployment artifact", 5),
      /deployment artifact must be a regular non-symlink file/,
    )

    execFileSync("mkfifo", [fifoPath])
    const readerModule = new URL("./release-files.ts", import.meta.url).href
    const fifoProbe = [
      `import { readBoundedRegularFile } from ${JSON.stringify(readerModule)}`,
      `await readBoundedRegularFile(${JSON.stringify(fifoPath)}, "deployment artifact", 5).then(() => process.exit(2), () => undefined)`,
    ].join(";")
    await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "--eval", fifoProbe],
      { timeout: 1000 },
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("release file metadata comparison detects every captured mutation", () => {
  const unchanged = {
    dev: 1n,
    ino: 2n,
    size: 3n,
    mtimeNs: 4n,
    ctimeNs: 5n,
  }
  assert.equal(openedFileMetadataChanged(unchanged, { ...unchanged }), false)
  for (const [field, value] of [
    ["dev", 11n],
    ["ino", 12n],
    ["size", 13n],
    ["mtimeNs", 14n],
    ["ctimeNs", 15n],
  ] as const) {
    assert.equal(
      openedFileMetadataChanged(unchanged, { ...unchanged, [field]: value }),
      true,
      field,
    )
  }
})
