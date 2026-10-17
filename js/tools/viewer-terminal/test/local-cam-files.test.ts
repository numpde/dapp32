import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { CAM_RESOURCE_MAX_BYTES } from "../../../packages/cam-protocol/dist/index.js"
import { localCamResourcePath, readBoundedFile, readBoundedFileSync } from "../../local-cam-files.ts"

test("local CAM resource inspection distinguishes missing paths from filesystem failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cam-local-file-"))
  try {
    await writeFile(join(directory, "not-a-directory"), "{}")
    for (const [uri, errno] of [["./missing.json", "ENOENT"], ["./not-a-directory/resource.json", "ENOTDIR"]] as const) {
      await assert.rejects(() => localCamResourcePath({ rootPath: join(directory, "main.json"), uri, resourceLabel: "test CAM resource" }), (error: unknown) => {
        assert(error instanceof Error)
        assert(error.cause instanceof Error && "code" in error.cause)
        assert.equal(error.cause.code, errno)
        if (errno === "ENOENT") assert.match(error.message, /does not exist/)
        else {
          assert.match(error.message, /Cannot inspect test CAM resource.*ENOTDIR/)
          assert.doesNotMatch(error.message, /does not exist/)
        }
        return true
      })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("bounded local CAM file readers accept exact-limit files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cam-local-file-"))
  try {
    const path = join(directory, "resource.json")
    await writeFile(path, new Uint8Array(CAM_RESOURCE_MAX_BYTES))

    assert.equal((await readBoundedFile(path, "test CAM resource")).byteLength, CAM_RESOURCE_MAX_BYTES)
    assert.equal(readBoundedFileSync(path, "test CAM resource").byteLength, CAM_RESOURCE_MAX_BYTES)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("bounded local CAM file readers reject oversized files", async () => {
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
