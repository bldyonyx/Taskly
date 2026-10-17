import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDataBoundary, CLOUD_SYNC_ENABLED } from '../src/js/data/boundary.js'
import { createAccountData } from '../src/js/data/account.js'
import { createFirestoreRepository } from '../src/js/firestore/repository.js'
import { validateTransition } from '../src/js/firestore/schema.js'
import { createFinishedDay, getFinishedDayDateKey, loadFinishedDays } from '../src/js/lists/finishedDays.js'
import { documents } from './helpers/firestore-fixtures.js'
import { inspectFinishedDayDates, resolveFinishedDayDates } from '../src/js/data/legacyFinishedDays.js'

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
    account(uid) {
      emit(uid)
      const path = `users/${uid}/lifecycle/state`
      if (!db.has(path)) db.set(path, { schemaVersion: 1, ownerId: uid, revision: 0, parents: {} })
      return createAccountData(createFirestoreRepository({ uid, session, transport }))
    },
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
  await a.reorderTasks(date, ['a', 'b'], (await a.loadAccount()).revision)
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
  await assert.rejects(a.saveList(list), /explicit replacement/)
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
  assert.equal(f.db.size, 1) // Only the pre-seeded empty manifest exists.
  f.fail(false)
  let resume
  f.pause(() => new Promise((resolve) => { resume = resolve }))
  const writing = a.createTask(date, task('a'), 0)
  await new Promise((resolve) => setImmediate(resolve))
  f.emit('bob'); f.emit('alice')
  resume()
  await assert.rejects(writing, /changed/)
  assert.equal(f.db.size, 1)
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
  f.transport.read = () => new Promise((resolve) => { release = resolve })
  const a = f.account('alice')
  const reading = a.loadSavedLists()
  f.emit(null); f.emit('alice')
  release(null)
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

const listInput = (tasks = [task('a'), task('b')]) => ({ id: 'list', name: 'List', createdAt: 'original', updatedAt: 'original', order: 0, tasks })
const revision = async (account) => (await account.loadAccount()).revision

test('reordering rejects stale views, incomplete membership and concurrent device changes', async () => {
  const f = fixture()
  const a = f.account('alice')
  const b = f.account('alice')
  await a.createTask(date, task('a'), 0)
  await a.createTask(date, task('b'), 1)
  const version = await revision(a)
  await a.reorderTasks(date, ['b', 'a'], version)
  await assert.rejects(b.reorderTasks(date, ['a', 'b'], version), { code: 'taskly/conflict' })
  await assert.rejects(a.reorderTasks(date, ['a'], await revision(a)), /complete current/)
  await assert.rejects(async () => a.reorderTasks(date, ['a', 'b']), /expected account revision/)
  const view = await revision(b)
  await a.createTask(date, task('c'), 0)
  await assert.rejects(b.reorderTasks(date, ['a', 'b'], view), { code: 'taskly/conflict' })
  assert.deepEqual((await a.loadTasks(date)).map(({ id, order }) => [id, order]), [['c', 0], ['b', 1], ['a', 2]])
})

test('a revision changing between preparation and commit rejects the transaction plan', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.createTask(date, task('a'), 0)
  const version = await revision(a)
  let resume
  f.pause(() => new Promise((resolve) => { resume = resolve }))
  const reorder = a.reorderTasks(date, ['a'], version)
  await new Promise((resolve) => setImmediate(resolve))
  f.db.get('users/alice/lifecycle/state').revision++
  resume()
  await assert.rejects(reorder, { code: 'taskly/conflict' })
  assert.equal(f.db.get(`users/alice/days/${date}/tasks/a`).order, 0)
})

test('snapshot replacement is atomic, preserves references, and retries without mixed tasks', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.saveList(listInput())
  await a.setCurrentList(date, 'list')
  const version = await revision(a)
  const replacement = { ...listInput([task('b'), { ...task('c'), completed: true }]), name: 'Replaced', updatedAt: 'later' }
  const before = structuredClone(f.db)
  f.fail(true)
  await assert.rejects(a.replaceSavedList(replacement, version), /failed commit/)
  assert.deepEqual(f.db, before)
  f.fail(false)
  await a.replaceSavedList(replacement, version)
  assert.equal(f.db.has('users/alice/savedLists/list/tasks/a'), false)
  assert.deepEqual((await a.loadSavedLists())[0].tasks.map(({ id }) => id), ['b', 'c'])
  assert.equal(await a.loadCurrentList(date), 'list')
  await assert.rejects(a.replaceSavedList(listInput(), version), { code: 'taskly/conflict' })
  const current = await revision(a)
  await assert.rejects(a.replaceSavedList({ ...replacement, createdAt: 'changed' }, current), /Immutable/)
  assert.equal(await revision(a), current)
})

test('cascading deletion removes children and references atomically and stale retries cannot delete a recreation', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.saveList(listInput())
  await a.setCurrentList(date, 'list')
  await a.setCurrentList('2026-10-18', 'list')
  const version = await revision(a)
  const before = structuredClone(f.db)
  f.fail(true)
  await assert.rejects(a.deleteSavedList('list', version), /failed commit/)
  assert.deepEqual(f.db, before)
  f.fail(false)
  await a.deleteSavedList('list', version)
  assert.equal([...f.db.keys()].some((key) => key.startsWith('users/alice/savedLists/list')), false)
  assert.equal(await a.loadCurrentList(date), null)
  assert.equal(await a.loadCurrentList('2026-10-18'), null)
  await a.saveList(listInput())
  await assert.rejects(a.deleteSavedList('list', version), { code: 'taskly/conflict' })
  assert.equal((await a.loadSavedLists()).length, 1)
  await a.createTask(date, task('a'), 0)
  await a.deleteDay(date, await revision(a))
  assert.equal([...f.db.keys()].some((key) => key.startsWith(`users/alice/days/${date}`)), false)
})

test('Finish Day commits one exact snapshot and clear, preserves states and IDs, and rejects stale retries', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.createTask(date, { ...task('a'), completed: true }, 0)
  await a.createTask(date, task('b'), 1)
  await a.saveList(listInput())
  await a.setCurrentList(date, 'list')
  const version = await revision(a)
  const metadata = { id: 'finished', createdAt: 'time', order: 0 }
  const before = structuredClone(f.db)
  f.fail(true)
  await assert.rejects(a.finishDay(date, metadata, version), /failed commit/)
  assert.deepEqual(f.db, before)
  f.fail(false)
  await a.finishDay(date, metadata, version)
  assert.deepEqual(await a.loadTasks(date), [])
  assert.equal(await a.loadCurrentList(date), null)
  const finished = (await a.loadFinishedDays())[0]
  assert.equal(finished.dateKey, date)
  assert.equal(finished.date, date)
  assert.deepEqual(finished.tasks.map(({ id, completed }) => [id, completed]), [['a', true], ['b', false]])
  assert.equal(finished.completedCount, 1)
  assert.equal([...f.db.keys()].some((key) => key.startsWith(`users/alice/days/${date}/tasks/`)), false)
  await a.createTask(date, task('new'), 0)
  await assert.rejects(a.finishDay(date, metadata, version), { code: 'taskly/conflict' })
  assert.equal((await a.loadTasks(date))[0].id, 'new')
  await a.deleteFinishedDay('finished', await revision(a))
  assert.equal([...f.db.keys()].some((key) => key.startsWith('users/alice/finishedDays/')), false)
})

test('uninitialized, corrupt and oversized accounts fail closed without adoption or partial writes', async () => {
  const f = fixture()
  const a = f.account('alice')
  f.db.clear()
  await assert.rejects(a.loadAccount(), { code: 'taskly/uninitialized' })
  await assert.rejects(a.initializeEmptyAccount(), { code: 'taskly/confirmation-required' })
  f.db.set(`users/alice/days/${date}`, { schemaVersion: 1, ownerId: 'alice', dateKey: date, currentListId: null })
  await assert.rejects(a.initializeEmptyAccount({ confirmedEmpty: true }), { code: 'taskly/reconciliation-required' })
  assert.equal(f.db.has('users/alice/lifecycle/state'), false)
  f.db.clear()
  await a.initializeEmptyAccount({ confirmedEmpty: true })
  await assert.rejects(a.initializeEmptyAccount({ confirmedEmpty: true }), { code: 'taskly/conflict' })
  await assert.rejects(a.saveList(listInput(Array.from({ length: 350 }, (_, i) => task(`t${i}`)))), /bounded lifecycle limit/)
  assert.equal(f.db.size, 1)
  await a.createTask(date, task('a'), 0)
  f.db.delete(`users/alice/days/${date}/tasks/a`)
  await assert.rejects(a.deleteDay(date, 1), { code: 'taskly/integrity' })
})

test('timestamp-only finished days require explicit, source-matched review without mutation', () => {
  const records = [{ id: 'legacy', date: '2026-10-17T22:30:00Z', tasks: [task('a')] },
    { id: 'stable', date: '2026-10-18', tasks: [] }]
  const before = structuredClone(records)
  assert.deepEqual(inspectFinishedDayDates(records).map(({ status }) => status), ['needs-review', 'resolved'])
  assert.throws(() => resolveFinishedDayDates(records, []), { code: 'taskly/ambiguous-date' })
  for (const patch of [{ reviewed: false }, { originalDate: 'changed' }, { dateKey: '2026-02-30' }]) {
    assert.throws(() => resolveFinishedDayDates(records, [{ id: 'legacy', reviewed: true,
      originalDate: records[0].date, dateKey: date, ...patch }]), { code: 'taskly/ambiguous-date' })
  }
  const resolved = resolveFinishedDayDates(records, [{ id: 'legacy', reviewed: true, originalDate: records[0].date, dateKey: '2026-10-18' }])
  assert.equal(resolved[0].dateKey, '2026-10-18')
  assert.equal(resolved[0].date, records[0].date)
  assert.equal(resolved[1].dateKey, '2026-10-18')
  assert.deepEqual(records, before)
  assert.deepEqual(inspectFinishedDayDates([{ id: 'bad', date: '2026-02-30T22:00:00Z' },
    { id: 'conflict', date: date, dateKey: '2026-10-18' }]).map(({ status }) => status), ['invalid', 'invalid'])
})

test('an acknowledged-late snapshot replacement cannot report success after an account switch', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.saveList(listInput())
  const version = await revision(a)
  const original = f.transport.transact
  let release
  f.transport.transact = async (...args) => {
    await original(...args)
    await new Promise((resolve) => { release = resolve })
  }
  const writing = a.replaceSavedList(listInput([task('new')]), version)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(f.db.has('users/alice/savedLists/list/tasks/new'), true)
  f.emit('bob')
  release()
  await assert.rejects(writing, /changed/)
  assert.equal([...f.db.keys()].some((key) => key.startsWith('users/bob/')), false)
})

test('rules denials from competing commits become conflicts, genuine permission failures remain failures', async () => {
  const f = fixture()
  const a = f.account('alice')
  await a.createTask(date, task('a'), 0)
  const version = await revision(a)
  f.transport.transact = async () => { throw Object.assign(new Error('Denied'), { code: 'permission-denied' }) }
  await assert.rejects(a.reorderTasks(date, ['a'], version), { code: 'permission-denied' })
  f.transport.transact = async () => {
    f.db.get('users/alice/lifecycle/state').revision++
    throw Object.assign(new Error('Denied after a concurrent commit'), { code: 'permission-denied' })
  }
  await assert.rejects(a.reorderTasks(date, ['a'], version), { code: 'taskly/conflict' })
})
