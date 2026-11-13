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
const home = architecture.home
// The root is a declared parent page; the six section landings are its
// children, not duplicate top-level navigation tabs.
const pages = [home, ...sections.flatMap(section => [
  section.landing,
  ...section.groups.flatMap(group => group.kind === 'pages' ? group.pages : []),
])]
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
  if (sectionId === null) {
    if (page.source !== 'index.md' || page.route !== 'index.md') {
      throw new Error('Site root must own index.md at the root URL')
    }
  } else if (!page.route.startsWith(sectionId + '/')) {
    throw new Error('Wrong page section')
  }
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
if (architecture.version !== 3 || !home || !home.text) {
  throw new Error('Missing or invalid site-root ownership')
}
ownPage(home, null)
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
if (architecture.version !== 3 || sections.length === 0) {
  throw new Error('Invalid documentation architecture')
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
const expected = new Set(usedSources)
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

function escapedAt(value, at) {
  let slashes = 0
  for (let index = at - 1; index >= 0 && value[index] === '\\'; index--) slashes++
  return slashes % 2 !== 0
}

function rewriteMarkdownLinks(value, rewrite) {
  let cursor = 0
  let output = ''
  while (true) {
    const opening = value.indexOf('](', cursor)
    if (opening < 0) return output + value.slice(cursor)
    const label = value.lastIndexOf('[', opening)
    if (label < 0 || escapedAt(value, label)) {
      output += value.slice(cursor, opening + 2)
      cursor = opening + 2
      continue
    }
    const start = opening + 2
    const angle = value[start] === '<'
    const destinationStart = start + (angle ? 1 : 0)
    let end = destinationStart
    let depth = 0
    while (end < value.length) {
      const character = value[end]
      if (character === '\\') {
        end += 2
        continue
      }
      if (angle && character === '>') break
      if (!angle && character === '(') depth++
      else if (!angle && character === ')') {
        if (depth === 0) break
        depth--
      } else if (!angle && /\s/.test(character) && depth === 0) break
      end++
    }
    const after = end + (angle ? 1 : 0)
    let valid = end > destinationStart && (!angle || value[end] === '>')
    if (valid && value[after] !== ')') {
      let position = after
      while (/\s/.test(value[position] ?? '')) position++
      const delimiter = value[position]
      valid = position > after && ['"', "'", '('].includes(delimiter)
      if (valid) {
        const closing = delimiter === '(' ? ')' : delimiter
        position++
        while (position < value.length && (value[position] !== closing || escapedAt(value, position))) {
          position++
        }
        if (position >= value.length) valid = false
        position++
        while (/\s/.test(value[position] ?? '')) position++
        if (value[position] !== ')') valid = false
      }
    }
    if (!valid) {
      output += value.slice(cursor, opening + 2)
      cursor = opening + 2
      continue
    }
    output += value.slice(cursor, destinationStart) + rewrite(value.slice(destinationStart, end))
    cursor = end
  }
}

function rewriteProse(value, rewrite) {
  const segments = value.split(/(<\/?[A-Za-z][^>]*>)/g)
  let inCode = false
  return segments.map(segment => {
    if (/^<code(?:\s|>)/i.test(segment)) {
      inCode = true
      return segment
    }
    if (/^<\/code\s*>/i.test(segment)) {
      inCode = false
      return segment
    }
    if (inCode) return segment
    if (/^<[A-Za-z]/.test(segment)) {
      return segment.replace(/(?<![:\w-])(href|src)=(["'])([^"'<>]+)\2/g,
        (_match, attribute, quote, url) => attribute + '=' + quote + rewrite(url) + quote)
    }
    return rewriteMarkdownLinks(segment, rewrite)
  }).join('')
}

function rewriteOutsideInlineCode(value, rewrite) {
  let cursor = 0
  let output = ''
  while (true) {
    const opening = value.indexOf('`', cursor)
    if (opening < 0) return output + rewriteProse(value.slice(cursor), rewrite)
    let runEnd = opening + 1
    while (value[runEnd] === '`') runEnd++
    const marker = value.slice(opening, runEnd)
    const closing = value.indexOf(marker, runEnd)
    if (closing < 0) return output + rewriteProse(value.slice(cursor), rewrite)
    output += rewriteProse(value.slice(cursor, opening), rewrite)
    output += value.slice(opening, closing + marker.length)
    cursor = closing + marker.length
  }
}

function rewriteDocumentLinks(content, rewrite) {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let frontmatter = false
  let fence = null
  let rawBlock = null
  let comment = false
  return lines.map((line, index) => {
    const trimmed = line.trim()
    if (index === 0 && trimmed === '---') {
      frontmatter = true
      return line
    }
    if (frontmatter) {
      if (trimmed === '---') frontmatter = false
      return line
    }
    if (comment) {
      if (line.includes('-->')) comment = false
      return line
    }
    if (rawBlock) {
      if (new RegExp('</' + rawBlock + '\\s*>', 'i').test(line)) rawBlock = null
      return line
    }
    if (fence) {
      const close = new RegExp('^ {0,3}' + fence.marker + '{' + fence.length + ',}\\s*$')
      if (close.test(trimmed)) fence = null
      return line
    }
    const openingFence = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (openingFence) {
      fence = { marker: openingFence[1][0], length: openingFence[1].length }
      return line
    }
    if (/^(?: {4}|\t)/.test(line)) return line
    if (trimmed.startsWith('<!--')) {
      comment = !trimmed.includes('-->')
      return line
    }
    const startRaw = /<(pre|script|style|textarea)(?:\s|>)/i.exec(line)
    if (startRaw) {
      if (!new RegExp('</' + startRaw[1] + '\\s*>', 'i').test(line.slice(startRaw.index))) {
        rawBlock = startRaw[1]
      }
      return line
    }
    return rewriteOutsideInlineCode(line, rewrite)
  }).join('')
}

for (const original of observed) {
  if (original in retired) {
    await rm(join(root, original))
    continue
  }
  const page = pages.find(item => item.source === original)
  if (!page) throw new Error('Unowned Markdown page: ' + original)
  const canonical = page.route
  const file = join(root, original)
  let content = await readFile(file, 'utf8')
  content = rewriteDocumentLinks(content, url => rewriteLink(url, original, canonical))
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
