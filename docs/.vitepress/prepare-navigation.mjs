// Normalize legacy links in the disposable build tree, never the checkout.
// One route inventory owns navigation, breadcrumbs and compatibility redirects.
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join, dirname, posix, isAbsolute } from 'node:path'

const root = process.argv[2]
if (process.argv.length !== 3 || !root || !isAbsolute(root)) {
  throw new Error('Pass one absolute staged documentation directory')
}
const architecture = JSON.parse(await readFile(join(root, '.vitepress/architecture.json'), 'utf8'))
const sections = architecture.sections
// Landing pages have one owner but are not duplicated in their sidebars.
const pages = sections.flatMap(section => [
  section.landing,
  ...section.groups.flatMap(group => group.kind === 'pages' ? group.pages : []),
])
const retired = architecture.retired

function isSource(value) {
  return /^(?:[a-z][a-z0-9-]*\/)*[a-z][a-z0-9-]*\.md$/.test(value)
}
function pageUrl(markdown) {
  return markdown.endsWith('/index.md')
    ? markdown.slice(0, -'index.md'.length)
    : markdown.slice(0, -3) + '.html'
}
function assertCanonical(value) {
  if (!/^(?:[a-z][a-z0-9-]*\/)*(?:[a-z][a-z0-9-]*\.html)?$/.test(value)) {
    throw new Error('Unsafe target URL: ' + value)
  }
}
const oldToNew = new Map()
const usedSources = new Set()
const usedTargets = new Set()
function ownPage(page, sectionId) {
  if (!isSource(page.source) || !isSource(page.route)) throw new Error('Invalid page')
  if (!page.route.startsWith(sectionId + '/')) throw new Error('Wrong page section')
  if (usedSources.has(page.source) || usedTargets.has(page.route)) {
    throw new Error('Page has multiple homes: ' + page.source)
  }
  usedSources.add(page.source)
  usedTargets.add(page.route)
  const original = pageUrl(page.source)
  const canonical = pageUrl(page.route)
  assertCanonical(canonical)
  if (original !== canonical) oldToNew.set(original, canonical)
}
for (const section of sections) {
  if (!/^[a-z][a-z0-9-]*$/.test(section.id)) throw new Error('Unsafe section ID')
  if (section.landing.route !== section.id + '/index.md') throw new Error('Invalid section landing')
  ownPage(section.landing, section.id)
  for (const group of section.groups) {
    if (group.kind === 'catalog') {
      if (section.id !== 'gallery' || group.catalog !== 'gallery/deployments.json'
          || group.anchor !== 'appId') throw new Error('Unknown in-section collection')
      continue
    }
    if (group.kind !== 'pages' || !Array.isArray(group.pages) || !group.pages.length) {
      throw new Error('Invalid sidebar group')
    }
    for (const page of group.pages) ownPage(page, section.id)
  }
}
for (const [source, target] of Object.entries(retired)) {
  if (!isSource(source) || usedSources.has(source)) throw new Error('Invalid retired page')
  assertCanonical(target)
  usedSources.add(source)
  oldToNew.set(pageUrl(source), target)
}
if (architecture.version !== 2 || sections.length !== 6 || pages.length < sections.length) {
  throw new Error('Unexpected documentation page inventory')
}
async function markdownFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name === '.vitepress' || entry.name === 'public') continue
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) files.push(...await markdownFiles(join(directory, entry.name), relative))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(relative)
  }
  return files
}
const observed = new Set(await markdownFiles(root))
const expected = new Set([...usedSources, 'index.md'])
if (observed.size !== expected.size
    || [...observed].some(source => !expected.has(source))) {
  throw new Error('Documentation pages lack exactly one navigation owner: '
    + [...observed].filter(source => !expected.has(source)).join(', '))
}
function rewriteLink(value, originalPage, canonicalPage) {
  if (!value || value.startsWith('#') || value.startsWith('//')
      || /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value)) return value

  const originalUrl = pageUrl(originalPage)
  const canonicalUrl = pageUrl(canonicalPage)
  const base = new URL('https://docs.invalid/dapp32/' + originalUrl)
  const resolved = new URL(value, base)
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith('/dapp32/')) return value

  const originalTarget = decodeURIComponent(resolved.pathname.slice('/dapp32/'.length))
  const destination = oldToNew.get(originalTarget) ?? originalTarget
  const fromDirectory = canonicalUrl.endsWith('/')
    ? canonicalUrl : posix.dirname(canonicalUrl)
  let relative = posix.relative(fromDirectory, destination)
  if (!relative) relative = './'
  else if (!relative.startsWith('.')) relative = './' + relative
  if (destination.endsWith('/') && !relative.endsWith('/')) relative += '/'
  return relative + resolved.search + resolved.hash
}
for (const original of observed) {
  if (original in retired) {
    await rm(join(root, original))
    continue
  }
  const page = pages.find(item => item.source === original)
  const canonical = page?.route ?? original
  const file = join(root, original)
  let content = await readFile(file, 'utf8')
  content = content.replace(/\b(href|src)=(["'])([^"'<>]+)\2/g,
    (_whole, attribute, quote, url) =>
      attribute + '=' + quote + rewriteLink(url, original, canonical) + quote)
  content = content.replace(/\]\(([^)\s]+)\)/g,
    (_whole, url) => '](' + rewriteLink(url, original, canonical) + ')')
  await writeFile(file, content)
}
for (const [original, canonical] of oldToNew) {
  const redirect = join(root, 'public', original.endsWith('/') ? original + 'index.html' : original)
  await mkdir(dirname(redirect), { recursive: true })
  const destination = '/dapp32/' + canonical
  const escaped = destination.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  await writeFile(redirect, [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta http-equiv="refresh" content="0;url=' + escaped + '">',
    '<link rel="canonical" href="' + escaped + '">',
    '<title>Page moved</title></head>',
    '<body><p>This guide moved to <a href="' + escaped + '">' + escaped + '</a>.</p>',
    '<script>location.replace(' + JSON.stringify(destination) + ' + location.search + location.hash)</script>',
    '</body></html>',
  ].join('\n') + '\n')
}
console.log('Prepared ' + pages.length + ' canonical guides and ' + oldToNew.size + ' legacy redirects')
