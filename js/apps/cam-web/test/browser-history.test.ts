import assert from 'node:assert/strict'
import test from 'node:test'
import { createBrowserHistory } from '../src/browser-history.ts'

function fixture() {
  const entries: { state: unknown; url: string }[] = [{ state: null, url: 'https://viewer.test/#start' }]
  let index = 0
  const moves: number[] = []
  const port = {
    get state() { return entries[index]!.state },
    get href() { return entries[index]!.url },
    replaceState(state: unknown, _unused: string, url: string | URL | null) { entries[index] = { state, url: String(url) } },
    pushState(state: unknown, _unused: string, url: string | URL | null) { entries.splice(++index); entries.push({ state, url: String(url) }) },
    go(delta: number) { moves.push(delta) },
  }
  const history = createBrowserHistory(port, 'session')
  return { history, entries, moves, port, move(to: number) { index = to }, fragment(url: string, inherit: boolean) { port.pushState(inherit ? port.state : null, '', url) } }
}

test('successful explicit reads push distinct visits even at the same URL; refresh replaces', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, f.port.href, 'push')
  f.history.commit(2, f.port.href, 'replace')
  assert.equal(f.entries.length, 2)
  assert.equal(f.history.canGoBack(), true)
  assert.deepEqual(f.port.state, { camViewer: 'session', visitId: 2, position: 1 })
  assert.equal(JSON.stringify(f.entries).includes('draft'), false)
})

test('direct entry has no phantom Back and popstate/hashchange resolve the same target once', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  assert.equal(f.history.canGoBack(), false)
  f.history.commit(2, 'https://viewer.test/#next', 'push')
  f.move(0)
  const target = f.history.observe()
  assert.equal(target?.visitId, 1)
  assert.equal(f.history.observe(), undefined)
  assert.equal(f.history.isCurrent(target!), true)
  f.history.commit(1, f.port.href, target!)
  assert.equal(f.entries.length, 2)
})

test('failed traversal compensates without replacing the failed target entry', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, 'https://viewer.test/#next', 'push')
  f.move(0)
  const target = f.history.observe()!
  const before = structuredClone(f.entries[0])
  f.history.restore("committed")
  assert.deepEqual(f.moves, [1])
  assert.deepEqual(f.entries[0], before)
  f.move(1)
  assert.equal(f.history.observe(), undefined, 'compensation must not re-read the committed visit')
  assert.equal(f.history.isCurrent(target), false)
})

test('manual fragments get a position so busy rejection can go Back without corrupting the new entry', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.fragment('https://viewer.test/#external', false)
  const target = f.history.observe()!
  assert.equal(target.visitId, undefined)
  f.history.restore("committed")
  assert.deepEqual(f.moves, [-1])
  assert.equal(f.entries[1]!.url, 'https://viewer.test/#external')
})

test('rapid traversal invalidates an async target before it can write into another browser slot', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, 'https://viewer.test/#two', 'push')
  f.history.commit(3, 'https://viewer.test/#three', 'push')
  f.move(1)
  const first = f.history.observe()!
  f.move(0)
  const second = f.history.observe()!
  assert.equal(f.history.isCurrent(first), false)
  assert.equal(f.history.isCurrent(second), true)
})


test('manual fragment with inherited history state is a new visit, not a traversal', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.fragment('https://viewer.test/#manual', true)
  const target = f.history.observe()!
  assert.equal(target.position, 1)
  assert.equal(target.visitId, undefined)
  assert.equal(f.history.observe(), undefined)
})

test('reload preserves absolute positions but cannot restore old-session drafts', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, 'https://viewer.test/#two', 'push')
  const reloaded = createBrowserHistory(f.port, 'reloaded')
  reloaded.commit(1, f.port.href, 'replace')
  assert.equal(reloaded.canGoBack(), false)
  f.move(0)
  const target = reloaded.observe()!
  assert.equal(target.position, 0)
  assert.equal(target.visitId, undefined)
  reloaded.restore("committed")
  assert.deepEqual(f.moves, [1])
})

test('read commits wait for compensating traversal to reach its intended browser slot', async () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, 'https://viewer.test/#two', 'push')
  f.move(0)
  f.history.observe()
  f.history.restore("committed")
  let settled = false
  const waiting = f.history.settled().then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false, 'async read could write into the rejected Back target')
  f.move(1)
  assert.equal(f.history.observe(), undefined)
  await waiting
  assert.equal(settled, true)
})

test('Back remains available on a new branch after traversing before the reload entry', () => {
  const f = fixture()
  f.history.commit(1, f.port.href, 'replace')
  f.history.commit(2, 'https://viewer.test/#two', 'push')
  const reloaded = createBrowserHistory(f.port, 'reloaded')
  reloaded.commit(1, f.port.href, 'replace')
  assert.equal(reloaded.canGoBack(), false, 'reload must not invent a previous viewer visit')
  f.move(0)
  const earlier = reloaded.observe()!
  reloaded.commit(2, f.port.href, earlier)
  assert.equal(reloaded.canGoBack(), false, 'earliest known entry must not invent Back')
  reloaded.commit(3, 'https://viewer.test/#branch', 'push')
  assert.equal(reloaded.canGoBack(), true, 'new branch has the successfully visited earlier entry behind it')
})
