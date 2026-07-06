import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { CAM_RESOURCE_MAX_BYTES } from "../../../packages/cam-protocol/dist/index.js"
import { readBoundedFile, readBoundedFileSync } from "../../local-cam-files.ts"

test("bounded local CAM file readers reject oversized files while reading", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cam-local-file-"))
  try {
    const path = join(directory, "resource.json")
    await writeFile(path, new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1))

    await assert.rejects(
      () => readBoundedFile(path, "test CAM resource"),
      /test CAM resource is too large/,
    )
    assert.throws(
      () => readBoundedFileSync(path, "test CAM resource"),
      /test CAM resource is too large/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

