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

    const referenceDirectory = join(root, 'reference/cam/1.4.0')
    await mkdir(referenceDirectory, { recursive: true })
    await writeFile(join(referenceDirectory, 'index.html'),
      '<!doctype html><html><body>Immutable specification</body></html>\n')

    const run = spawnSync(process.execPath, [prepare, root], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr || run.stdout)
    await inspect(await readFile(join(root, 'authoring/example.md'), 'utf8'), root)
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

test('rebase live Markdown, image, reference, and multiline destinations', async () => {
  const source = [
    '# Guide',
    '',
    '[ordinary](../start/) and ![icon](../start/icon.svg)',
    '[angle](<../start/> "Start page") and [titled](../start/ "Start")',
    '[reference][start-page]',
    '',
    '[start-page]: ../start/ "Start"',
    '',
    '[multiline](',
    '  ../start/',
    ')',
    '',
  ].join('\n')
  const expected = [
    '# Guide',
    '',
    '[ordinary](./) and ![icon](./icon.svg)',
    '[angle](<./> "Start page") and [titled](./ "Start")',
    '[reference][start-page]',
    '',
    '[start-page]: ./ "Start"',
    '',
    '[multiline](',
    '  ./',
    ')',
    '',
  ].join('\n')
  await withPreparedGuide(source, actual => assert.equal(actual, expected))
})

test('preserve literal Markdown, comments, raw HTML blocks, and Vue bindings', async () => {
  const source = [
    '---',
    'description: "A [link](../start/) in metadata"',
    '---',
    '',
    '# Guide',
    '',
    '```md',
    '[literal](../start/)',
    '```',
    '',
    '~~~html',
    '<a href="../start/">example</a>',
    '~~~',
    '',
    '    [indented](../start/)',
    '',
    '<!--',
    '[commented](../start/)',
    '-->',
    '',
    '<pre>',
    '<a href="../start/">preformatted</a>',
    '</pre>',
    '',
    '<script>',
    'const sample = "[literal](../start/)"',
    '</script>',
    '',
    '<AppLink :href="selected" data-href="../start/" />',
    '',
    '[real](../start/)',
    '',
  ].join('\n')
  const expected = source.replace('[real](../start/)', '[real](./)')
  await withPreparedGuide(source, actual => assert.equal(actual, expected))
})

test('leave independently published HTML bytes untouched and create only route redirects', async () => {
  await withPreparedGuide('# Guide\n', async (actual, root) => {
    assert.equal(actual, '# Guide\n')
    const reference = await readFile(join(root, 'reference/cam/1.4.0/index.html'), 'utf8')
    assert.equal(reference, '<!doctype html><html><body>Immutable specification</body></html>\n')
    const redirect = await readFile(join(root, 'public/authoring/example.html'), 'utf8')
    assert.match(redirect, /\/dapp32\/start\/example\.html/)
    assert.doesNotMatch(redirect, /Immutable specification/)
  })
})
