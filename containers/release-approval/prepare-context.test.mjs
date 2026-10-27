import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

import { prepareContext, RUNTIME_SOURCES } from './prepare-context.mjs'
import { approvalInputDigest } from './approval-inputs.mjs'

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

test('image builder gives Compose a valid project name for mixed-case temporary paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'approval-project-name-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fixtureSource = join(root, 'source')
  const workRoot = join(root, 'work')
  const output = join(root, 'image-output')
  const log = join(root, 'docker-args')
  await mkdir(workRoot)
  await mkdir(output)
  for (const path of [
    'compose/package-deps.yml',
    'compose/release/approval-image.yml',
    'containers/release-approval/Dockerfile',
    'containers/release-approval/prepare-context.mjs',
    'containers/node-deps/Dockerfile',
    'containers/https-egress-proxy/Dockerfile',
    'js/package.json',
    'js/package-lock.json',
    'js/packages/protocol/package.json',
    'js/apps/viewer/package.json',
  ]) {
    const file = join(fixtureSource, path)
    await mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true })
    await writeFile(file, '{}\n')
  }
  const imageId = `sha256:${'a'.repeat(64)}`
  const sourceCommit = 'b'.repeat(40)
  const script = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../tools/release_approval_image_build.sh')
  const outputPath = join(output, 'new-image')
  const runner = `
APPROVAL_TEST_SETSID=$(type -P setsid) || exit
export APPROVAL_TEST_SETSID
# The doubles are Bash functions; keep real session ownership through a shell.
setsid() {
  exec "$APPROVAL_TEST_SETSID" "$BASH" -c '"$@"' approval-test-owned "$@"
}
docker() {
  printf '%s\\n' "$*" >> "$APPROVAL_TEST_DOCKER_LOG"
  if [[ "$1" == compose ]]; then
    local project
    while [[ "$1" != -p ]]; do shift; done
    project="$2"
    [[ "$project" =~ ^cam-approval-image-[a-z0-9]+(-identity)?$ ]] || return 91
    if [[ "$*" == *'release-approval-identity'* ]]; then printf '%s\\n' "$(printf 'c%.0s' {1..64})"; fi
    return 0
  fi
  if [[ "$1 $2" == 'image ls' ]]; then
    if [[ "\${APPROVAL_TEST_CACHED-0}" == 1 ]]; then printf '%s\\n' "$APPROVAL_TEST_IMAGE_ID"; fi
    return 0
  fi
  if [[ "$1" == build ]]; then printf '%s\\n' "$APPROVAL_TEST_IMAGE_ID"; return 0; fi
  if [[ "$1 $2" == 'image inspect' ]]; then
    if [[ "$*" == *org.opencontainers.image.revision* ]]; then
      local entrypoint='["node","--experimental-strip-types","/app/tools/release-approval/run.ts"]'
      if [[ "\${APPROVAL_TEST_BAD_ENTRYPOINT-0}" == 1 ]]; then entrypoint='["node","unrelated.js"]'; fi
      printf '%s %s %s operator %s\\n' "$APPROVAL_TEST_IMAGE_ID" "$APPROVAL_TEST_SOURCE_COMMIT" "$(printf 'c%.0s' {1..64})" "$entrypoint"
    elif [[ "$*" == *--format* ]]; then
      printf '%s\\n' "$APPROVAL_TEST_IMAGE_ID"
    fi
    return 0
  fi
  return 93
}
git() {
  if [[ "$1 $3" == '-C cat-file' ]]; then printf 'commit\\n'; return 0; fi
  if [[ "$1 $3" == '-C archive' ]]; then
    local argument output=
    for argument in "$@"; do
      case "$argument" in --output=*) output="\${argument#--output=}" ;; esac
    done
    [[ -n "$output" ]] || return 95
    tar -cf "$output" -C "$APPROVAL_TEST_SOURCE" .
    return
  fi
  return 94
}
mktemp() {
  if [[ "$#" == 1 && "$1" == -d ]]; then
    local path="$APPROVAL_TEST_WORK_ROOT/build-TmpABC123"
    mkdir "$path"
    printf '%s\\n' "$path"
  else
    /usr/bin/mktemp "$@"
  fi
}
export -f setsid docker git mktemp
exec bash "$@"
`
  const testEnv = {
    ...process.env,
    APPROVAL_TEST_DOCKER_LOG: log,
    APPROVAL_TEST_IMAGE_ID: imageId,
    APPROVAL_TEST_SOURCE_COMMIT: sourceCommit,
    APPROVAL_TEST_SOURCE: fixtureSource,
    APPROVAL_TEST_WORK_ROOT: workRoot,
  }
  const result = spawnSync('bash', ['-c', runner, 'approval-test', script, sourceCommit, outputPath], {
    encoding: 'utf8',
    env: testEnv,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const composeCalls = (await readFile(log, 'utf8')).split('\n').filter(line => line.startsWith('compose '))
  assert.equal(composeCalls.length, 6)
  for (const call of composeCalls) {
    assert.match(call, /\s-p cam-approval-image-[a-z0-9]+(?:-identity)?\s/)
    assert.doesNotMatch(call, /\s-p [^ ]*[A-Z]/)
  }
  const artifact = JSON.parse(await readFile(join(output, 'new-image', 'approval-image.json'), 'utf8'))
  assert.equal(artifact.imageId, imageId)
  assert.equal(artifact.approvalToolSourceCommit, sourceCommit)
  assert.match(composeCalls.at(-1), /\sdown(?:\s|$)/)
  assert.deepEqual(await readdir(workRoot), [])
  await writeFile(log, '')
  const reused = spawnSync('bash', ['-c', runner, 'approval-test', script, 'd'.repeat(40), join(output, 'reused-image')], {
    encoding: 'utf8', env: { ...testEnv, APPROVAL_TEST_CACHED: '1' },
  })
  assert.equal(reused.status, 0, reused.stdout + reused.stderr)
  const reusedCalls = await readFile(log, 'utf8')
  assert.doesNotMatch(reusedCalls, /package-stage|package-egress-proxy|^build /m)
  const reusedArtifact = JSON.parse(await readFile(join(output, 'reused-image', 'approval-image.json'), 'utf8'))
  assert.equal(reusedArtifact.imageId, imageId)
  assert.equal(reusedArtifact.approvalToolSourceCommit, sourceCommit, 'reuse retains the actual producing source')
  for (const [name, env, commit] of [
    ['wrong-entrypoint', { APPROVAL_TEST_CACHED: '1', APPROVAL_TEST_BAD_ENTRYPOINT: '1' }, sourceCommit],
    ['wrong-fresh-source', { APPROVAL_TEST_CACHED: '0' }, 'd'.repeat(40)],
  ]) {
    const rejected = spawnSync('bash', ['-c', runner, 'approval-test', script, commit, join(output, name)], {
      encoding: 'utf8', env: { ...testEnv, ...env },
    })
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /entrypoint or fresh-build source/)
    await assert.rejects(readFile(join(output, name, 'approval-image.json')))
  }
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


test('approval identity follows staged inputs rather than unrelated source changes', async t => {
  const f = await fixture(t)
  await writeFile(join(f.image, 'prepare-context.mjs'), `export const RUNTIME_SOURCES = ${JSON.stringify(RUNTIME_SOURCES)}`)
  const original = await approvalInputDigest(f.source, f.image)
  await writeFile(join(f.source, 'unrelated-notes.txt'), 'a different repository commit')
  assert.equal(await approvalInputDigest(f.source, f.image), original)
  const runtime = join(f.source, RUNTIME_SOURCES[0])
  await chmod(runtime, 0o600)
  assert.equal(await approvalInputDigest(f.source, f.image), original, 'instance umask does not change tool identity')
  await chmod(runtime, 0o700)
  const executable = await approvalInputDigest(f.source, f.image)
  assert.notEqual(executable, original)
  await chmod(runtime, 0o755)
  assert.equal(await approvalInputDigest(f.source, f.image), executable, 'final image normalizes executable file modes')
  await chmod(runtime, 0o644)
  for (const path of [join(f.source, RUNTIME_SOURCES[0]), join(f.source, 'package-lock.json'),
    join(f.image, 'Dockerfile'), join(f.image, '.dockerignore'), join(f.image, 'prepare-context.mjs')]) {
    const bytes = await readFile(path)
    await writeFile(path, Buffer.concat([bytes, Buffer.from('changed')]))
    assert.notEqual(await approvalInputDigest(f.source, f.image), original)
    await writeFile(path, bytes)
  }
})
