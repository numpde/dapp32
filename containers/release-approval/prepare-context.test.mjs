import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { prepareContext, RUNTIME_SOURCES } from './prepare-context.mjs'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'approval-image-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'js')
  const dependencies = join(root, 'dependencies')
  const image = join(root, 'image')
  const output = join(root, 'output')
  await mkdir(source)
  await mkdir(dependencies)
  await mkdir(image)
  await mkdir(output)
  await writeFile(join(image, 'Dockerfile'), 'FROM scratch\n')
  await writeFile(join(image, '.dockerignore'), '*\n!Dockerfile\n')
  for (const relative of RUNTIME_SOURCES) {
    const path = join(source, relative)
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, `// ${relative}\n`)
  }
  await writeFile(join(source, 'tools', 'release-approval', 'fixture-only.test.ts'), 'fixture only\n')
  await mkdir(join(dependencies, 'node_modules', 'viem'), { recursive: true })
  await mkdir(join(dependencies, 'node_modules', 'ox'), { recursive: true })
  await mkdir(join(dependencies, 'node_modules', 'unrelated'), { recursive: true })
  await writeFile(join(dependencies, 'node_modules', 'viem', 'package.json'), JSON.stringify({ name: 'viem', version: '2.0.0' }))
  await writeFile(join(dependencies, 'node_modules', 'ox', 'package.json'), JSON.stringify({ name: 'ox', version: '1.0.0' }))
  await writeFile(join(dependencies, 'node_modules', 'unrelated', 'package.json'), JSON.stringify({ name: 'unrelated', version: '1.0.0' }))
  await writeFile(join(source, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/viem': { version: '2.0.0', dependencies: { ox: '1.0.0' } },
      'node_modules/ox': { version: '1.0.0' },
      'node_modules/unrelated': { version: '1.0.0' },
    },
  }))
  await writeFile(join(dependencies, 'package-lock.json'), await readFile(join(source, 'package-lock.json')))
  return { source, dependencies, image, output }
}

test('stages only the runtime source and locked transitive packages', async t => {
  const f = await fixture(t)
  await prepareContext(f)
  assert.deepEqual(await readdir(join(f.output, 'node_modules')), ['ox', 'viem'])
  assert.equal(await readFile(join(f.output, 'tools', 'release-approval', 'run.ts'), 'utf8'), '// tools/release-approval/run.ts\n')
  assert.rejects(readFile(join(f.output, 'tools', 'release-approval', 'fixture-only.test.ts')))
  assert.deepEqual((await readdir(f.output)).sort(), ['.dockerignore', 'Dockerfile', 'node_modules', 'package.json', 'tools'])
})

test('refuses missing or changed locked package before making a build context', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dependencies, 'node_modules', 'ox', 'package.json'), JSON.stringify({ name: 'ox', version: '1.1.0' }))
  await assert.rejects(prepareContext(f), /ox.*lock/)
  assert.deepEqual(await readdir(f.output), [])
})

test('refuses dependency output from another lockfile before making a build context', async t => {
  const f = await fixture(t)
  await writeFile(join(f.dependencies, 'package-lock.json'), '{}')
  await assert.rejects(prepareContext(f), /dependency stage.*lockfile/i)
  assert.deepEqual(await readdir(f.output), [])
})

test('host node_modules cannot enter the staged image context', async t => {
  const f = await fixture(t)
  await mkdir(join(f.source, 'node_modules', 'viem'), { recursive: true })
  await writeFile(join(f.source, 'node_modules', 'viem', 'package.json'), JSON.stringify({ name: 'viem', version: '2.0.0' }))
  await writeFile(join(f.source, 'node_modules', 'viem', 'host-poison'), 'do not ship')
  await prepareContext(f)
  await assert.rejects(readFile(join(f.output, 'node_modules', 'viem', 'host-poison')))
})

test('refuses source symlinks before making a build context', async t => {
  const f = await fixture(t)
  const path = join(f.source, 'tools', 'release-approval', 'run.ts')
  await rm(path)
  await symlink('/etc/passwd', path)
  await assert.rejects(prepareContext(f), /symlink/)
  assert.deepEqual(await readdir(f.output), [])
})

test('requires a fresh empty output directory', async t => {
  const f = await fixture(t)
  await writeFile(join(f.output, 'old'), 'stale')
  await assert.rejects(prepareContext(f), /empty/)
})

test('image artifact path must be a new normalized external directory without symlink ancestors', async t => {
  const root = await mkdtemp(join(tmpdir(), 'approval-output-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const real = join(root, 'real')
  const link = join(root, 'link')
  await mkdir(real)
  await symlink(real, link)
  const script = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../tools/release_approval_image_build.sh')
  const fakeCommit = 'a'.repeat(40)
  for (const [path, reason] of [
    ['relative-output', /normalized absolute path/],
    [`${root}/../unnormalized-output`, /normalized absolute path/],
    [join(resolve(script, '../..'), 'image-output'), /outside the repository/],
    [join(link, 'image-output'), /symlink/],
    [real, /must be new/],
  ]) {
    const result = spawnSync('bash', [script, fakeCommit, path], { encoding: 'utf8' })
    assert.notEqual(result.status, 0, path)
    assert.match(result.stderr, reason, path)
  }
  const validPath = join(real, 'new-image-output')
  const result = spawnSync('bash', [script, fakeCommit, validPath], { encoding: 'utf8' })
  assert.match(result.stderr, /SOURCE_COMMIT must identify a local Git commit/)
  await assert.rejects(lstat(validPath), { code: 'ENOENT' })
})

test('real staged runtime loads without release preparers or workspace packages', async t => {
  const image = fileURLToPath(new URL('.', import.meta.url))
  const source = process.env.RELEASE_APPROVAL_TEST_SOURCE ?? resolve(image, '../../js')
  const dependencies = process.env.RELEASE_APPROVAL_TEST_DEPENDENCIES ?? source
  const output = await mkdtemp(join(tmpdir(), 'approval-image-real-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  await prepareContext({ source, dependencies, image, output })
  const runtime = await import(pathToFileURL(join(output, 'tools/release-approval/run.ts')).href)
  assert.equal(typeof runtime.startApprovalRuntime, 'function')
  assert.deepEqual((await readdir(join(output, 'tools', 'release-approval'))).sort(),
    RUNTIME_SOURCES.filter(path => path.startsWith('tools/release-approval/')).map(path => path.split('/').at(-1)).sort())
})
