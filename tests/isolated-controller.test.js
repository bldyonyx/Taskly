import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveConfig } from 'vite'
import { createIsolatedController, emptyData } from '../src/isolated/controller.js'
import { assertIsolatedRuntime } from '../src/isolated/config.js'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture() {
  let identity = { phase: 'loading', user: null }
  const subscribers = new Set()
  const calls = []
  const accountData = new Map()
  const session = { getState: () => identity, subscribe(fn) { subscribers.add(fn); fn(identity); return () => subscribers.delete(fn) } }
  const emit = (uid, pending = null) => {
    identity = { phase: uid ? 'authenticated' : 'guest', user: uid ? { uid } : null, pending }
    for (const fn of [...subscribers]) fn(identity)
  }
  const guestData = { ...emptyData(), tasksByDate: { '2026-10-17': [{ id: 'guest', text: 'Private guest', completed: false }] } }
  const options = { session,
    readGuest() { calls.push('guest-read'); return { data: structuredClone(guestData), theme: 'forest' } },
    writeGuest(...args) { calls.push(['guest-write', ...args]) },
    async createAccount(uid) {
      calls.push(['factory', uid])
      const source = accountData.get(uid) ?? { revision: 1, aggregates: { 'days/2026-10-17': {
        metadata: { dateKey: '2026-10-17', currentListId: null }, tasks: [{ id: uid, text: uid, completed: false }],
      } } }
      return { loadAccount: async () => structuredClone(source), loadTheme: async () => 'ocean',
        dispose() { calls.push(['dispose', uid]) }, initializeEmptyAccount: async () => ({ confirmed: true }) }
    },
  }
  return { options, emit, calls, accountData, guestData }
}

test('isolated controller waits for Auth and keeps guest/account/two-account data separate', async () => {
  const f = fixture()
  const c = createIsolatedController(f.options)
  assert.equal(c.getState().kind, 'blocked')
  assert.deepEqual(f.calls, [])
  f.emit(null)
  assert.equal(c.getState().data.tasksByDate['2026-10-17'][0].id, 'guest')
  f.emit('a')
  assert.deepEqual(c.getState().data, emptyData())
  assert.equal(c.getState().theme, 'plum')
  await tick()
  assert.equal(c.getState().data.tasksByDate['2026-10-17'][0].id, 'a')
  assert.equal(c.saveGuest(f.guestData, ['tasks']), false)
  f.emit('b')
  assert.deepEqual(c.getState().data, emptyData())
  await tick()
  assert.equal(c.getState().data.tasksByDate['2026-10-17'][0].id, 'b')
  f.emit(null)
  assert.equal(c.getState().theme, 'forest')
  assert.deepEqual(c.getState().data, f.guestData)
  assert.equal(f.calls.some((call) => call[0] === 'guest-write'), false)
  c.dispose()
})

test('rapid account switches dispose late factories and suppress stale reads and callbacks', async () => {
  const f = fixture()
  const lateFactory = deferred()
  const lateRead = deferred()
  let disposed = 0
  f.options.createAccount = async (uid) => uid === 'a' ? lateFactory.promise : {
    loadAccount: () => lateRead.promise, loadTheme: async () => 'rose', dispose() { disposed++ },
  }
  const c = createIsolatedController(f.options)
  f.emit('a'); f.emit('b'); f.emit(null)
  lateFactory.resolve({ dispose() { disposed++ } })
  lateRead.resolve({ revision: 88, aggregates: {} })
  await tick()
  assert.equal(c.getState().kind, 'guest')
  assert.deepEqual(c.getState().data, f.guestData)
  assert.equal(disposed, 2)
  c.dispose()
})

test('displayed revisions are retained during saving; success requires commit and authoritative reload', async () => {
  const f = fixture()
  const source = { revision: 7, aggregates: {} }
  f.accountData.set('a', source)
  const c = createIsolatedController(f.options)
  f.emit('a'); await tick()
  const write = deferred()
  let token
  const pending = c.mutate((_account, revision) => { token = revision; return write.promise })
  assert.equal(c.getState().phase, 'saving')
  assert.equal(c.getState().revision, 7)
  assert.equal(await c.mutate(() => { throw new Error('Duplicate operation') }), false)
  source.revision = 8
  write.resolve({ confirmed: true })
  assert.equal(await pending, true)
  assert.equal(token, 7)
  assert.equal(c.getState().revision, 8)
  assert.equal(c.getState().phase, 'saved')
  c.dispose()
})

test('conflicts, offline failures, limits and unconfirmed writes never become success or automatic retries', async () => {
  const f = fixture()
  const c = createIsolatedController(f.options)
  f.emit('a'); await tick()
  for (const [error, phase] of [
    [Object.assign(new Error('Conflict'), { code: 'taskly/conflict' }), 'conflict'],
    [Object.assign(new Error('Unavailable'), { code: 'unavailable' }), 'offline'],
    [new Error('Account exceeds size limit'), 'failed'], [new Error('Denied'), 'failed'],
  ]) {
    let attempts = 0
    assert.equal(await c.mutate(async () => { attempts++; throw error }), false)
    assert.equal(c.getState().phase, phase)
    assert.equal(attempts, 1)
    assert.equal(await c.mutate(async () => ({ confirmed: true })), false)
    await c.refresh()
  }
  assert.equal(await c.mutate(async () => ({})), false)
  assert.equal(c.getState().phase, 'failed')
  c.dispose()
})

test('pending logout clears synchronously; acknowledged-late writes cannot affect the next context', async () => {
  const f = fixture()
  const c = createIsolatedController(f.options)
  f.emit('a'); await tick()
  const write = deferred()
  const oldEpoch = c.getState().epoch
  const pending = c.mutate(() => write.promise)
  f.emit('a', 'logout')
  assert.deepEqual(c.getState().data, emptyData())
  f.emit('b'); await tick()
  write.resolve({ confirmed: true })
  assert.equal(await pending, false)
  assert.equal(await c.mutate(async () => ({ confirmed: true }), oldEpoch), false)
  assert.equal(c.getState().uid, 'b')
  assert.equal(c.getState().phase, 'ready')
  c.dispose()
})

test('reload restores the same account from its server state without guest initialization', async () => {
  const f = fixture()
  f.emit('a')
  const first = createIsolatedController(f.options)
  await tick()
  const expected = first.getState().data
  first.dispose()
  const reloaded = createIsolatedController(f.options)
  assert.deepEqual(reloaded.getState().data, emptyData())
  await tick()
  assert.deepEqual(reloaded.getState().data, expected)
  assert.equal(f.calls.includes('guest-read'), false)
  reloaded.dispose()
})

test('isolated runtime rejects production, remote hosts, missing opt-in and wrong modes', () => {
  const allowed = { enabled: true, dev: true, mode: 'cloud-test', hostname: '127.0.0.1' }
  assert.doesNotThrow(() => assertIsolatedRuntime(allowed))
  for (const patch of [{ enabled: false }, { dev: false }, { mode: 'production' }, { hostname: 'taskly.example' }]) {
    assert.throws(() => assertIsolatedRuntime({ ...allowed, ...patch }), /explicit loopback/)
  }
  const adapter = readFileSync('src/isolated/firebase.js', 'utf8')
  assert.doesNotMatch(adapter, /import\.meta\.env|readFirebaseConfig|getApp\(/)
  assert.match(adapter, /connectAuthEmulator/)
  assert.match(adapter, /connectFirestoreEmulator/)
})

test('Vite only exposes the isolated entry for an explicit development server, never a build', async () => {
  const development = await resolveConfig({ mode: 'cloud-test' }, 'serve')
  const normal = await resolveConfig({ mode: 'development' }, 'serve')
  const build = await resolveConfig({ mode: 'cloud-test' }, 'build')
  assert.equal(development.define.__TASKLY_ISOLATED_CLOUD__, 'true')
  assert.equal(Object.keys(development.env).some((key) => key.startsWith('VITE_FIREBASE_')), false)
  assert.equal(normal.define.__TASKLY_ISOLATED_CLOUD__, 'false')
  assert.equal(build.define.__TASKLY_ISOLATED_CLOUD__, 'false')
  assert.equal(build.plugins.some((plugin) => plugin.name === 'taskly-isolated-entry'), false)
  assert.match(development.server.headers['Content-Security-Policy'], /127\.0\.0\.1:8085/)
})
