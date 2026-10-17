import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDataBoundary, CLOUD_SYNC_ENABLED } from '../src/js/data/boundary.js'
import { createAccountData } from '../src/js/data/account.js'
import { createFirestoreRepository } from '../src/js/firestore/repository.js'
import { validateTransition } from '../src/js/firestore/schema.js'
import { createFinishedDay, getFinishedDayDateKey, loadFinishedDays } from '../src/js/lists/finishedDays.js'
import { documents } from './helpers/firestore-fixtures.js'

function fixture() {
  let state = { phase: 'guest', user: null, pending: null }
  const listeners = new Set()
  const db = new Map()
  const calls = []
  let fail = false
  let pause
  const session = {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn) },
  }
  const emit = (uid, pending = null) => {
    state = { phase: uid ? 'authenticated' : 'guest', user: uid ? { uid } : null, pending }
    for (const fn of [...listeners]) fn(state)
  }
  const transport = {
    async read(path) { calls.push(['read', path]); return structuredClone(db.get(path) ?? null) },
    async list(path) {
      calls.push(['list', path])
      return [...db].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1)
        .map(([key, data]) => ({ id: key.split('/').at(-1), data: structuredClone(data) })).reverse()
    },
    async transact(paths, plan) {
      calls.push(['transact', paths])
      if (pause) await pause()
      const changes = plan(paths.map((path) => structuredClone(db.get(path) ?? null)))
      if (fail) throw new Error('offline or failed commit')
      for (const { path, data } of changes) data === null ? db.delete(path) : db.set(path, structuredClone(data))
    },
  }
  return { session, emit, db, calls, transport,
    fail: (value) => { fail = value }, pause: (value) => { pause = value },
    account(uid) { emit(uid); return createAccountData(createFirestoreRepository({ uid, session, transport })) },
  }
}
const date = '2026-10-17'
const task = (id) => ({ id, text: id, completed: false })

test('boundary isolates guest and accounts, blocks loading/pending, never loads or migrates guest data', () => {
  const f = fixture()
  const guest = new Proxy({}, { get() { throw new Error('Guest data must not be accessed') } })
  const boundary = createDataBoundary({ session: f.session, guestRepository: guest })
  assert.equal(boundary.requireRepository(), guest)
  assert.equal(CLOUD_SYNC_ENABLED, false)
  f.emit('alice')
  const first = boundary.getContext()
  assert.equal(first.repository, null)
  assert.throws(() => boundary.requireRepository(), /disabled/)
  f.emit('bob'); f.emit('alice')
  assert.ok(boundary.getContext().generation > first.generation)
  f.emit('alice', 'logout')
  assert.equal(boundary.getContext().kind, 'blocked')
  f.emit(null)
  assert.equal(boundary.requireRepository(), guest)
  assert.deepEqual(f.calls, [])
  boundary.dispose()
})

test('empty accounts have no fallback; task mutations preserve IDs, order and account isolation', async () => {
  const f = fixture()
  const a = f.account('alice')
  assert.deepEqual(await a.loadTasks(date), [])
  await a.createTask(date, task('b'), 0)
  await a.createTask(date, task('a'), 1)
  await a.editTask(date, 'b', 'edited')
  await a.completeTask(date, 'b', true)
  await a.reorderTasks(date, ['a', 'b'])
  assert.deepEqual((await a.loadTasks(date)).map(({ id, order }) => [id, order]), [['a', 0], ['b', 1]])
  assert.equal((await a.loadTasks(date))[1].completed, true)
  await assert.rejects(a.createTask(date, task('a'), 0), /already exists/)
  await a.deleteTask(date, 'a')
  assert.equal((await a.loadTasks(date))[0].text, 'edited')
  const b = f.account('bob')
  assert.deepEqual(await b.loadTasks(date), [])
  await b.saveTheme('forest')
  await assert.rejects(a.loadTasks(date), /changed/)
  const again = f.account('alice')
  assert.equal(await again.loadTheme(), null)
  assert.equal((await again.loadTasks(date)).length, 1)
  f.emit(null)
  await assert.rejects(again.saveTheme('rose'), /changed/)
})

test('saved lists, references, finished snapshots and theme round trip without regenerating IDs', async () => {
  const f = fixture()
  const a = f.account('alice')
  const list = { id: 'list', name: 'List', createdAt: 'original', updatedAt: 'original', order: 0, tasks: [task('b'), task('a')] }
  await a.saveList(list)
  await a.setCurrentList(date, 'list')
  assert.equal(await a.loadCurrentList(date), 'list')
  await assert.rejects(a.setCurrentList(date, 'missing'), /does not exist/)
  assert.deepEqual((await a.loadSavedLists())[0].tasks.map(({ id }) => id), ['b', 'a'])
  await assert.rejects(a.saveList(list), /replacement is disabled/)
  const day = { id: 'finished', dateKey: date, date: '2026-10-16T22:00:00Z', createdAt: 'original', order: 0,
    totalCount: 2, completedCount: 0, tasks: list.tasks }
  await a.createFinishedDay(day)
  assert.equal((await a.loadFinishedDays())[0].dateKey, date)
  assert.deepEqual((await a.loadFinishedDays())[0].tasks.map(({ id }) => id), ['b', 'a'])
  await assert.rejects(async () => a.createFinishedDay({ ...day, dateKey: undefined }), /timestamp-only/)
  await a.saveTheme('midnight')
  assert.equal(await a.loadTheme(), 'midnight')
  await a.setCurrentList(date, null)
  assert.equal(await a.loadCurrentList(date), null)
})

test('failed writes are atomic and interrupted transaction retries cannot submit stale account writes', async () => {
  const f = fixture()
  const a = f.account('alice')
  f.fail(true)
  await assert.rejects(a.createTask(date, task('a'), 0), /failed commit/)
  assert.equal(f.db.size, 0)
  f.fail(false)
  let resume
  f.pause(() => new Promise((resolve) => { resume = resolve }))
  const writing = a.createTask(date, task('a'), 0)
  f.emit('bob'); f.emit('alice')
  resume()
  await assert.rejects(writing, /changed/)
  assert.equal(f.db.size, 0)
})

test('immutable-field validation mirrors rules, including completed import transitions', () => {
  for (const [path, fields] of [ ['savedLists/list-b', ['createdAt']],
    ['finishedDays/finished-b', ['dateKey', 'date', 'createdAt']], ['imports/import-1', ['sourceId', 'backupHash', 'createdAt']] ]) {
    const previous = documents().find((item) => item.path === path).data
    for (const key of fields) {
      const value = key === 'dateKey' ? '2026-10-19' : key === 'backupHash' ? 'b'.repeat(64) : 'changed'
      assert.throws(() => validateTransition('alice', path, previous, { ...previous, [key]: value }), /Immutable/)
    }
  }
  const previous = documents().find((item) => item.path === 'imports/import-1').data
  assert.throws(() => validateTransition('alice', 'imports/import-1', { ...previous, status: 'complete', completedAt: 'done' }, previous), /completed import/)
})

test('a submitted commit may finish after logout but cannot report confirmation to the old session', async () => {
  const f = fixture()
  let release
  const original = f.transport.transact
  f.transport.transact = async (...args) => {
    await original(...args)
    await new Promise((resolve) => { release = resolve })
  }
  const a = f.account('alice')
  const writing = a.saveTheme('forest')
  // Let the fake server commit before holding its acknowledgment.
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.db.get('users/alice/preferences/general').themeId, 'forest')
  f.emit('bob')
  release()
  await assert.rejects(writing, /changed/)
  assert.equal(f.db.has('users/bob/preferences/general'), false)
})

test('late collection reads cannot return an old account snapshot', async () => {
  const f = fixture()
  let release
  f.transport.list = () => new Promise((resolve) => { release = resolve })
  const a = f.account('alice')
  const reading = a.loadSavedLists()
  f.emit(null); f.emit('alice')
  release([])
  await assert.rejects(reading, /changed/)
})

test('new finished days retain local calendar keys; legacy records remain readable without storage writes', () => {
  const day = createFinishedDay([task('a')], new Date(2026, 9, 17))
  assert.equal(day.dateKey, date)
  const storage = { getItem: () => JSON.stringify([day]) }
  assert.equal(getFinishedDayDateKey(loadFinishedDays(storage)[0]), date)
  assert.equal(getFinishedDayDateKey({ dateKey: date, date: '2026-10-16T22:00:00Z' }), date)
  assert.equal(loadFinishedDays({ getItem: () => JSON.stringify([{ ...day, dateKey: undefined }]) }).length, 1)
})

test('startup gate has no Firebase adapter, environment override or automatic account factory', () => {
  const boundary = readFileSync('src/js/data/boundary.js', 'utf8')
  assert.doesNotMatch(boundary, /import\s|import\.meta|localStorage\.getItem|createFirebase/)
  assert.doesNotMatch(readFileSync('src/main.js', 'utf8'), /createAccountData|createFirebaseFirestoreRepository/)
})
