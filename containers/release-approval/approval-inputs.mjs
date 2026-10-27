import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { regularBelow } from './prepare-context.mjs'

// Source identity shares the image stager's runtime inventory; repository commits
// and image provenance labels are intentionally not inputs to the runtime cache.
export async function approvalInputDigest(source, image) {
  await regularBelow(image, join(image, 'prepare-context.mjs'))
  const { RUNTIME_SOURCES } = await import(pathToFileURL(join(image, 'prepare-context.mjs')).href)
  const inputs = [
    ['js/package-lock.json', join(source, 'package-lock.json')],
    ...RUNTIME_SOURCES.map(name => [`js/${name}`, join(source, name)]),
    ...['Dockerfile', '.dockerignore', 'prepare-context.mjs'].map(name => [`image/${name}`, join(image, name)]),
  ].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  const digest = createHash('sha256').update('cam-approval-inputs-v1\0')
  for (const [name, path] of inputs) {
    await regularBelow(name.startsWith('js/') ? source : image, path)
    const executable = ((await lstat(path)).mode & 0o111) !== 0
    const bytes = await readFile(path)
    digest.update(`${Buffer.byteLength(name)}:${name}:${Number(executable)}:${bytes.length}:`).update(bytes)
  }
  return digest.digest('hex')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  approvalInputDigest(process.argv[2], process.argv[3])
    .then(digest => process.stdout.write(`${digest}\n`))
    .catch(error => { process.stderr.write(`Cannot identify approval-tool inputs: ${error.message}\n`); process.exitCode = 1 })
}
