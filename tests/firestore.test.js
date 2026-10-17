import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mapLocalStateToDocuments, validateDocument, describeDocument, validateCollection, validDateKey } from '../src/js/firestore/schema.js'
import { createFirestoreRepository } from '../src/js/firestore/repository.js'
import { localState, documents } from './helpers/firestore-fixtures.js'

test('mapping preserves IDs, date associations, task order and completion without mutating input', () => {
  const state = localState()
  const original = structuredClone(state)
  const mapped = mapLocalStateToDocuments(state, { uid: 'alice', themeId: 'forest', finishedDayDateKeys: { 'finished-b': '2026-10-18' } })
  assert.deepEqual(state, original)
  assert.equal(mapped.find((doc) => doc.path === 'days/2026-10-18').data.currentListId, 'list-b')
  assert.equal(mapped.find((doc) => doc.path === 'finishedDays/finished-b').data.dateKey, '2026-10-18')
  assert.equal(mapped.find((doc) => doc.path === 'finishedDays/finished-b').data.date, state.finishedDays[0].date)
  for (const parent of ['days/2026-10-18', 'savedLists/list-b', 'finishedDays/finished-b']) {
    const tasks = mapped.filter((doc) => doc.path.startsWith(`${parent}/tasks/`)).map(({ data }) => data)
    assert.deepEqual(tasks.map(({ id, text, completed }) => ({ id, text, completed })), state.tasksByDate['2026-10-18'])
    assert.deepEqual(tasks.map((task) => task.order), [0, 1])
  }
  assert.equal(mapped.some((doc) => doc.path === 'days/2026-10-19'), true)
  assert.equal(mapped.some((doc) => doc.path.startsWith('imports/')), false)
})

test('finished-day calendar keys are explicit and independent of process timezone', () => {
  assert.throws(() => mapLocalStateToDocuments(localState(), { uid: 'alice', themeId: 'plum' }), /explicit original date key/)
  const moduleUrl = new URL('../src/js/firestore/schema.js', import.meta.url).href
  const fixtureUrl = new URL('./helpers/firestore-fixtures.js', import.meta.url).href
  const script = `import {mapLocalStateToDocuments} from ${JSON.stringify(moduleUrl)}; import {localState} from ${JSON.stringify(fixtureUrl)}; console.log(JSON.stringify(mapLocalStateToDocuments(localState(),{uid:'alice',themeId:'forest',finishedDayDateKeys:{'finished-b':'2026-10-18'}})));`
  const results = ['Pacific/Honolulu', 'Asia/Tokyo', 'Europe/Zurich'].map((timezone) => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout
  })
  assert.equal(results[0], results[1])
  assert.equal(results[1], results[2])
  const state = localState()
  state.finishedDays[0].date = '2026-10-18'
  assert.doesNotThrow(() => mapLocalStateToDocuments(state, { uid: 'alice', themeId: 'forest' }))
})

test('mapping rejects collisions, invalid relationships, counts and conflicting dates without repair', () => {
  const options = { uid: 'alice', themeId: 'forest', finishedDayDateKeys: { 'finished-b': '2026-10-18' } }
  for (const mutate of [
    (s) => { s.tasksByDate['2026-10-18'].push(s.tasksByDate['2026-10-18'][0]) },
    (s) => { s.currentListIdsByDate['2026-10-18'] = 'missing-list' },
    (s) => { s.finishedDays[0].completedCount = 2 },
    (s) => { s.finishedDays[0].dateKey = '2026-10-17' },
    (s) => { s.savedLists[0].id = 'bad/id' },
  ]) {
    const state = localState()
    mutate(state)
    const original = structuredClone(state)
    assert.throws(() => mapLocalStateToDocuments(state, options))
    assert.deepEqual(state, original)
  }
})

test('schema validation accepts every planned document and rejects owner, version and field changes', () => {
  for (const { path, data } of documents()) {
    assert.doesNotThrow(() => validateDocument('alice', path, data))
    for (const changed of [{ ...data, ownerId: 'bob' }, { ...data, schemaVersion: 2 }, { ...data, unexpected: true }]) {
      assert.throws(() => validateDocument('alice', path, changed))
    }
    const missing = { ...data }
    delete missing.ownerId
    assert.throws(() => validateDocument('alice', path, missing))
  }
  const task = documents().find((doc) => doc.path.includes('/tasks/'))
  for (const patch of [{ completed: 'yes' }, { order: -1 }, { order: 0.5 }, { text: '' }, { text: 'x'.repeat(10001) }, { id: 'different' }]) {
    assert.throws(() => validateDocument('alice', task.path, { ...task.data, ...patch }))
  }
  assert.throws(() => validateDocument('alice', 'preferences/general', { schemaVersion: 1, ownerId: 'alice', themeId: 'unknown' }))
})

test('paths reject traversal, arbitrary collections and invalid calendar dates', () => {
  for (const path of ['/users/bob', '../x', 'users/bob', 'other/item', 'days/2026-02-30', 'preferences/unknown', 'days/2026-10-18/tasks/a/extra/b']) {
    assert.throws(() => describeDocument(path))
  }
  for (const path of ['days', 'savedLists', 'finishedDays', 'preferences', 'imports', 'days/2026-10-18/tasks', 'savedLists/a/tasks', 'finishedDays/b/tasks']) {
    assert.equal(validateCollection(path), path)
  }
  assert.throws(() => validateCollection('users/bob/days'))
  assert.equal(validDateKey('2024-02-29'), true)
  assert.equal(validDateKey('2026-02-29'), false)
})

function fixture(phase = 'authenticated') {
  let state = { phase, user: phase === 'authenticated' ? { uid: 'alice' } : null, pending: null }
  const listeners = new Set()
  const calls = []
  let next
  let listenerStops = 0
  const data = documents().find((doc) => doc.path === 'days/2026-10-18').data
  const session = { getState: () => state, subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn) } }
  const transport = {
    async read(path) { calls.push(['read', path]); return data },
    async write(path, value) { calls.push(['write', path, value]) },
    async remove(path) { calls.push(['remove', path]) },
    subscribe(path, fn) { calls.push(['subscribe', path]); next = fn; return () => { listenerStops++ } },
  }
  return {
    session, transport, calls, data, next: (value) => next(value), stops: () => listenerStops,
    emit(patch) { state = { ...state, ...patch }; for (const fn of [...listeners]) fn(state) },
  }
}

test('repository construction is dormant; guest, loading and unavailable sessions are rejected', () => {
  for (const phase of ['guest', 'loading', 'unavailable']) {
    const f = fixture(phase)
    assert.throws(() => createFirestoreRepository({ uid: 'alice', ...f }), /not ready/)
    assert.deepEqual(f.calls, [])
  }
  const f = fixture()
  const repo = createFirestoreRepository({ uid: 'alice', ...f })
  assert.deepEqual(f.calls, [])
  repo.dispose()
})

test('explicit operations validate data and scope every path to the bound account', async () => {
  const f = fixture()
  const repo = createFirestoreRepository({ uid: 'alice', ...f })
  assert.deepEqual(await repo.read('days/2026-10-18'), f.data)
  const value = structuredClone(f.data)
  const pendingWrite = repo.write('days/2026-10-18', value)
  value.currentListId = 'changed-after-submit'
  await pendingWrite
  assert.deepEqual(f.calls[1], ['write', 'users/alice/days/2026-10-18', f.data])
  await assert.rejects(repo.write('days/2026-10-18', { ...f.data, ownerId: 'bob' }))
  await assert.rejects(repo.read('users/bob/days/2026-10-18'))
  await repo.remove('days/2026-10-18')
  assert.equal(f.calls.at(-1)[1], 'users/alice/days/2026-10-18')
  repo.dispose()
})

test('listeners stop on sign-out, pending auth and switching, including returning to the original UID', async () => {
  for (const change of [{ phase: 'guest', user: null }, { user: { uid: 'bob' } }, { pending: 'logout' }]) {
    const f = fixture()
    const repo = createFirestoreRepository({ uid: 'alice', ...f })
    let delivered = 0
    repo.subscribe('days', () => { delivered++ })
    f.next([{ id: '2026-10-18', data: f.data }])
    assert.equal(delivered, 1)
    f.emit(change)
    assert.equal(f.stops(), 1)
    f.next([{ id: '2026-10-18', data: f.data }])
    assert.equal(delivered, 1)
    f.emit({ phase: 'authenticated', user: { uid: 'alice' }, pending: null })
    await assert.rejects(repo.read('days/2026-10-18'), /changed/)
    repo.dispose()
  }
})

test('in-flight reads cannot deliver old-account results; invalid snapshots are rejected', async () => {
  const f = fixture()
  let resolve
  f.transport.read = () => new Promise((done) => { resolve = done })
  const repo = createFirestoreRepository({ uid: 'alice', ...f })
  const reading = repo.read('days/2026-10-18')
  f.emit({ user: { uid: 'bob' } })
  resolve(f.data)
  await assert.rejects(reading, /changed/)
  const g = fixture()
  const current = createFirestoreRepository({ uid: 'alice', ...g })
  let failure
  let delivered = false
  const stop = current.subscribe('days', () => { delivered = true }, (error) => { failure = error })
  g.next([{ id: '2026-10-18', data: { ...g.data, ownerId: 'bob' } }])
  assert.equal(delivered, false)
  assert.ok(failure)
  stop()
  stop()
  assert.equal(g.stops(), 1)
  current.dispose()
  repo.dispose()
})

test('the running application does not import or initialize the dormant Firestore modules', async () => {
  const paths = ['src/main.js', 'src/js/auth/index.js', 'src/js/auth/firebase.js', 'src/js/storage/repository.js']
  for (const path of paths) assert.doesNotMatch(readFileSync(path, 'utf8'), /from ['"][^'"]*firestore|import\(['"][^'"]*firestore/)
  await assert.doesNotReject(import('../src/js/firestore/firebase.js'))
})
