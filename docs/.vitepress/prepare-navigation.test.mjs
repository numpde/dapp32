import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const prepare = fileURLToPath(new URL('./prepare-navigation.mjs', import.meta.url))

async function withPreparedGuide(source, inspect) {
  const root = await mkdtemp(join(tmpdir(), 'dapp32-navigation-'))
  try {
    const model = {
      version: 3,
      home: { source: 'index.md', route: 'index.md', text: 'Home' },
      sections: [{
        id: 'start',
        label: 'Start',
        summary: 'Guide',
        landing: { source: 'start/index.md', route: 'start/index.md', text: 'Start' },
        groups: [{
          kind: 'pages',
          title: 'Guide',
          pages: [{ source: 'authoring/example.md', route: 'start/example.md', text: 'Example' }],
        }],
      }],
      retired: {},
    }
    for (const path of ['.vitepress', 'start', 'authoring']) {
      await mkdir(join(root, path), { recursive: true })
    }
    await writeFile(join(root, '.vitepress/architecture.json'), JSON.stringify(model))
    await writeFile(join(root, 'index.md'), '# Home\n')
    await writeFile(join(root, 'start/index.md'), '# Start\n')
    await writeFile(join(root, 'authoring/example.md'), source)

    const run = spawnSync(process.execPath, [prepare, root], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    await inspect(await readFile(join(root, 'authoring/example.md'), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('rewrite live links without rewriting fenced or inline code examples', async () => {
  const source = [
    '# Example',
    '',
    '[live](../start/) and <a href="../start/">HTML link</a>',
    '',
    '```md',
    '[fenced](../start/)',
    '<a href="../start/">Example attribute</a>',
    '```',
    '',
    '`[inline](../start/)` and `<a href="../start/">example</a>`',
    '',
    '    [indented](../start/)',
    '',
    '<pre><code>',
    '[preformatted](../start/)',
    '</code></pre>',
    '',
  ].join('\n')
  const expected = source.replace('[live](../start/)', '[live](./)')
    .replace('<a href="../start/">HTML link</a>', '<a href="./">HTML link</a>')
  await withPreparedGuide(source, actual => assert.equal(actual, expected))
})

test('rewrite CommonMark destinations with balanced parentheses and optional titles', async () => {
  const source = [
    '# Example',
    '',
    '[query](../start/?mode=demo(v2) "Start page")',
    '[titled](../start/ "Start page")',
    '[plain](../start/)',
    '',
  ].join('\n')
  const expected = source
    .replace('../start/?mode=demo(v2)', './?mode=demo(v2)')
    .replaceAll('](../start/', '](./')
  await withPreparedGuide(source, actual => assert.equal(actual, expected))
})

test('preserve escaped Markdown and Vue or data-bound attributes', async () => {
  const source = [
    '# Example',
    '',
    '\\[not a link](../start/)',
    '<AppLink :href="relativeUrl" data-href="../start/" />',
    '<a href="../start/" title="Run">Live</a>',
    '',
  ].join('\n')
  const expected = source.replace('<a href="../start/" title=', '<a href="./" title=')
  await withPreparedGuide(source, actual => assert.equal(actual, expected))
})
