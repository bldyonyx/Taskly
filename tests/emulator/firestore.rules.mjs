// Explicit emulator-only suite; not part of the default node --test discovery.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { initializeFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs,
  setDoc as rawSetDoc, updateDoc as rawUpdateDoc, deleteDoc as rawDeleteDoc, terminate, writeBatch, runTransaction, disableNetwork, enableNetwork } from 'firebase/firestore'
import { documents } from '../helpers/firestore-fixtures.js'
import { createFirestoreTransport } from '../../src/js/firestore/firebase.js'
import { createFirestoreRepository } from '../../src/js/firestore/repository.js'
import { createAccountData } from '../../src/js/data/account.js'

const projectId = 'demo-taskly-rules'
const host = process.env.FIRESTORE_EMULATOR_HOST
assert.match(host ?? '', /^(localhost|127\.0\.0\.1):\d+$/, 'Start the local Firestore emulator first; production endpoints are forbidden.')
assert.ok(!process.env.GCLOUD_PROJECT || process.env.GCLOUD_PROJECT === projectId, 'Use only the demo-taskly-rules project for this suite.')
const [hostname, port] = host.split(':')
const clients = new Map()
for (const uid of ['alice', 'alice-device2', 'bob', 'guest']) {
  const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: `test-${uid}` }, `rules-${uid}`)
  const db = initializeFirestore(app, {})
  const accountUid = uid === 'alice-device2' ? 'alice' : uid
  connectFirestoreEmulator(db, hostname, Number(port), uid === 'guest' ? {} : { mockUserToken: { sub: accountUid, user_id: accountUid } })
  clients.set(uid, { app, db })
}
const db = clients.get('alice').db
const ref = (client, path, uid = 'alice') => doc(clients.get(client).db, `users/${uid}${path ? `/${path}` : ''}`)
const denied = (operation) => assert.rejects(operation, (error) => error.code === 'permission-denied')
const fixtures = documents()
const admission = process.env.TASKLY_TEST_ADMISSION === '1'
// Emulator-only operator fixture, never a live Admin credential or SDK.
async function roster(uid, fields) {
  const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/stagingTesters/${uid}`, {
    method: fields === null ? 'DELETE' : 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    ...(fields === null ? {} : { body: JSON.stringify({ fields }) }),
    signal: AbortSignal.timeout(5000),
  })
  assert.equal(response.ok, true)
}
const admittedFields = () => ({ enabled: { booleanValue: true },
  expiresAt: { timestampValue: new Date(Date.now() + 3600000).toISOString() } })

// Valid schema/rules cases must also satisfy the new lifecycle protocol so field
// validation is exercised instead of failing only for a missing revision write.
async function protocolWrite(reference, value, mode = 'set') {
  const parts = reference.path.split('/')
  if (!['days', 'savedLists', 'finishedDays'].includes(parts[2]) || ![4, 6].includes(parts.length)) {
    if (mode === 'delete') return rawDeleteDoc(reference)
    return mode === 'update' ? rawUpdateDoc(reference, value) : rawSetDoc(reference, value)
  }
  return runTransaction(reference.firestore, async (transaction) => {
    const manifestRef = doc(reference.firestore, `users/${parts[1]}/lifecycle/state`)
    const manifest = (await transaction.get(manifestRef)).data()
    const previous = (await transaction.get(reference)).data()
    const parent = `${parts[2]}/${parts[3]}`
    const parents = structuredClone(manifest.parents)
    if (parts.length === 4) {
      if (mode === 'delete') delete parents[parent]
      else parents[parent] ??= []
    } else {
      parents[parent] ??= []
      if (mode === 'delete') parents[parent] = parents[parent].filter((id) => id !== parts[5])
      else if (!parents[parent].includes(parts[5])) parents[parent].push(parts[5])
    }
    transaction.set(manifestRef, { ...manifest, revision: manifest.revision + 1, parents })
    if (mode === 'delete') transaction.delete(reference)
    else transaction.set(reference, mode === 'update' ? { ...previous, ...value } : value)
  })
}
const setDoc = (reference, value) => protocolWrite(reference, value)
const updateDoc = (reference, value) => protocolWrite(reference, value, 'update')
const deleteDoc = (reference) => protocolWrite(reference, null, 'delete')

before(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
  assert.equal(response.ok, true)
  if (admission) for (const uid of ['alice', 'bob']) await roster(uid, admittedFields())
  // Rules must already be loaded by firebase emulators:exec/start using firebase.json.
  await rawSetDoc(ref('alice', 'lifecycle/state'), { schemaVersion: 1, ownerId: 'alice', revision: 0, parents: {} })
  await rawSetDoc(ref('bob', 'lifecycle/state', 'bob'), { schemaVersion: 1, ownerId: 'bob', revision: 0, parents: {} })
  const parents = {}
  const batch = writeBatch(db)
  for (const { path, data } of fixtures) {
    const parts = path.split('/')
    if (['days', 'savedLists', 'finishedDays'].includes(parts[0])) {
      const parent = parts.slice(0, 2).join('/')
      parents[parent] ??= []
      if (parts.length === 4) parents[parent].push(data.id)
    }
    batch.set(ref('alice', path), data)
  }
  batch.set(ref('alice', 'lifecycle/state'), { schemaVersion: 1, ownerId: 'alice', revision: 1, parents })
  await batch.commit()
})
after(async () => {
  await Promise.all([...clients.values()].map(async ({ app, db }) => { await terminate(db); await deleteApp(app) }))
})

test('owners can read and update every planned document, including all nested task collections', async () => {
  for (const { path, data } of fixtures) {
    assert.deepEqual((await getDoc(ref('alice', path))).data(), data)
    await setDoc(ref('alice', path), data)
  }
  for (const path of ['days', 'savedLists', 'finishedDays', 'preferences', 'imports', 'days/2026-10-18/tasks', 'savedLists/list-b/tasks', 'finishedDays/finished-b/tasks']) {
    assert.equal((await getDocs(collection(db, `users/alice/${path}`))).empty, false)
    await denied(getDocs(collection(clients.get('bob').db, `users/alice/${path}`)))
  }
})

test('guests and another account cannot read, write or delete any planned document', async () => {
  for (const client of ['guest', 'bob']) for (const { path, data } of fixtures) {
    await denied(getDoc(ref(client, path)))
    await denied(setDoc(ref(client, path), data))
    await denied(deleteDoc(ref(client, path)))
    // Bypass the helper's preliminary manifest read: exercise write authorization
    // itself rather than letting a denied read mask a write-rule regression.
    await denied(rawSetDoc(ref(client, path), data))
    await denied(rawDeleteDoc(ref(client, path)))
  }
  const manifest = (await getDoc(ref('alice', 'lifecycle/state'))).data()
  for (const client of ['guest', 'bob']) {
    await denied(getDoc(ref(client, 'lifecycle/state')))
    await denied(rawSetDoc(ref(client, 'lifecycle/state'), { ...manifest, revision: manifest.revision + 1 }))
    await denied(rawDeleteDoc(ref(client, 'lifecycle/state')))
  }
})

test('ownership, version, field sets and document IDs cannot be forged or changed', async () => {
  for (const { path, data } of fixtures) {
    for (const patch of [{ ownerId: 'bob' }, { schemaVersion: 2 }, { extraField: true }]) {
      await denied(setDoc(ref('alice', path), { ...data, ...patch }))
    }
    const missing = { ...data }
    delete missing.ownerId
    await denied(setDoc(ref('alice', path), missing))
    if (Object.hasOwn(data, 'id')) await denied(updateDoc(ref('alice', path), { id: 'forged' }))
  }
  await denied(setDoc(ref('bob', 'days/2026-10-18', 'bob'), fixtures.find((d) => d.path === 'days/2026-10-18').data))
})

test('invalid tasks, days, preferences and finished-day calendar changes are rejected', async () => {
  for (const parent of ['days/2026-10-18', 'savedLists/list-b', 'finishedDays/finished-b']) {
    for (const patch of [{ completed: 'yes' }, { order: -1 }, { order: 0.5 }, { text: '' }, { text: 'x'.repeat(10001) }]) {
      await denied(updateDoc(ref('alice', `${parent}/tasks/task-b`), patch))
    }
  }
  await denied(updateDoc(ref('alice', 'days/2026-10-18'), { dateKey: '2026-10-19' }))
  await denied(updateDoc(ref('alice', 'days/2026-10-18'), { currentListId: 7 }))
  await denied(updateDoc(ref('alice', 'finishedDays/finished-b'), { dateKey: '2026-10-19' }))
  await denied(updateDoc(ref('alice', 'savedLists/list-b'), { createdAt: 'changed' }))
  await denied(updateDoc(ref('alice', 'finishedDays/finished-b'), { date: '2026-10-19' }))
  await denied(updateDoc(ref('alice', 'finishedDays/finished-b'), { totalCount: 0 }))
  await denied(updateDoc(ref('alice', 'preferences/general'), { themeId: 'unknown' }))
  await denied(setDoc(ref('alice', 'preferences/other'), { schemaVersion: 1, ownerId: 'alice', themeId: 'forest' }))
})

test('import tracking validates state and cannot be reverted from complete to pending', async () => {
  await denied(updateDoc(ref('alice', 'imports/import-1'), { backupHash: 'not-a-hash' }))
  await denied(updateDoc(ref('alice', 'imports/import-1'), { sourceId: 'different' }))
  await denied(updateDoc(ref('alice', 'imports/import-1'), { status: 'complete', completedAt: null }))
  await updateDoc(ref('alice', 'imports/import-1'), { status: 'complete', completedAt: '2026-10-18T12:01:00Z' })
  await denied(updateDoc(ref('alice', 'imports/import-1'), { status: 'pending', completedAt: null }))
})

test('unknown collections and unplanned nesting remain denied', async () => {
  for (const path of ['unknown/document', 'days/2026-10-18/tasks/task-b/notes/note', 'savedLists/list-b/unknown/document']) {
    await denied(setDoc(ref('alice', path), { ownerId: 'alice', schemaVersion: 1 }))
    await denied(getDoc(ref('alice', path)))
  }
  await denied(setDoc(doc(db, 'outside/document'), { ownerId: 'alice' }))
})

test('owners can delete their own documents; deletes do not grant cross-user rights', async () => {
  const path = 'days/2026-10-20'
  await setDoc(ref('alice', path), { ownerId: 'alice', schemaVersion: 1, dateKey: '2026-10-20', currentListId: null })
  await deleteDoc(ref('alice', path))
  assert.equal((await getDoc(ref('alice', path))).exists(), false)
})

test('account operations use rules-compatible atomic transactions through the real SDK adapter', async () => {
  const session = { getState: () => ({ phase: 'authenticated', user: { uid: 'alice' } }),
    subscribe: () => () => {} }
  const repository = createFirestoreRepository({ uid: 'alice', session,
    transport: createFirestoreTransport({ database: () => db, check: () => {} }) })
  const account = createAccountData(repository)
  const dateKey = '2026-11-01'
  await account.createTask(dateKey, { id: 'one', text: 'One', completed: false }, 0)
  await account.createTask(dateKey, { id: 'two', text: 'Two', completed: false }, 1)
  await account.completeTask(dateKey, 'one', true)
  await account.editTask(dateKey, 'two', 'Edited')
  await account.reorderTasks(dateKey, ['two', 'one'], (await account.loadAccount()).revision)
  const tasks = await account.loadTasks(dateKey)
  assert.deepEqual(tasks.map(({ id }) => id), ['two', 'one'])
  const snapshotTasks = tasks.map(({ id, text, completed }) => ({ id, text, completed }))
  await account.saveList({ id: 'atomic-list', name: 'Atomic', createdAt: 'original', updatedAt: 'original', order: 0, tasks: snapshotTasks })
  await account.setCurrentList(dateKey, 'atomic-list')
  assert.equal(await account.loadCurrentList(dateKey), 'atomic-list')
  await account.createFinishedDay({ id: 'atomic-finished', dateKey, date: dateKey, createdAt: 'original', order: 0,
    completedCount: 1, totalCount: 2, tasks: snapshotTasks })
  assert.deepEqual((await account.loadFinishedDays()).find(({ id }) => id === 'atomic-finished').tasks.map(({ id }) => id), ['two', 'one'])
  await account.saveTheme('rose')
  assert.equal(await account.loadTheme(), 'rose')
  const listPath = 'savedLists/atomic-list'
  const original = await repository.read(listPath)
  await assert.rejects(repository.write(listPath, { ...original, createdAt: 'changed' }), /Immutable/)
  assert.deepEqual(await repository.read(listPath), original)
  await assert.rejects(repository.remove(listPath), /Parent deletion/)
  // The second invalid mutation makes the entire transaction fail before commit.
  await assert.rejects(repository.atomic(['preferences/general', listPath], () => [
    { path: 'preferences/general', data: { schemaVersion: 1, ownerId: 'alice', themeId: 'forest' } },
    { path: listPath, data: { ...original, createdAt: 'changed' } },
  ]), /Immutable/)
  assert.equal(await account.loadTheme(), 'rose')
  // Prove server rules reject an entire transaction, with no partial valid write.
  const transport = createFirestoreTransport({ database: () => db, check: () => {} })
  const lifecycleBefore = await repository.read('lifecycle/state')
  await denied(transport.transact(['users/alice/lifecycle/state', 'users/alice/preferences/general', `users/alice/${listPath}`], () => [
    { path: 'users/alice/lifecycle/state', data: { ...lifecycleBefore, revision: lifecycleBefore.revision + 1 } },
    { path: 'users/alice/preferences/general', data: { schemaVersion: 1, ownerId: 'alice', themeId: 'forest' } },
    { path: `users/alice/${listPath}`, data: { ...original, createdAt: 'changed' } },
  ]))
  assert.equal(await account.loadTheme(), 'rose')
  assert.equal((await repository.read('lifecycle/state')).revision, lifecycleBefore.revision)
  await account.deleteTask(dateKey, 'one')
  assert.equal((await account.loadTasks(dateKey)).length, 1)
  account.dispose()
})

function accountClient(client = 'alice', uid = 'alice', transportOverride) {
  let state = { phase: 'authenticated', user: { uid } }
  const listeners = new Set()
  const session = { getState: () => state, subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn) } }
  const transport = createFirestoreTransport({ database: () => clients.get(client).db, check: () => {} })
  const repository = createFirestoreRepository({ uid, session, transport: transportOverride?.(transport) ?? transport })
  return { account: createAccountData(repository), repository,
    logout() { state = { phase: 'guest', user: null }; for (const fn of [...listeners]) fn(state) } }
}
const rev = async (account) => (await account.loadAccount()).revision

// Fresh UID per adversarial/boundary case: intentional same-owner corruption
// must not contaminate subsequent lifecycle tests. All clients use loopback.
let isolatedId = 0
async function freshCase() {
  const uid = `phase47-${++isolatedId}`
  const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: uid }, uid)
  const database = initializeFirestore(app, {})
  connectFirestoreEmulator(database, hostname, Number(port), { mockUserToken: { sub: uid, user_id: uid } })
  clients.set(uid, { app, db: database })
  if (admission) await roster(uid, admittedFields())
  const context = accountClient(uid, uid)
  await context.account.initializeEmptyAccount({ confirmedEmpty: true })
  return { ...context, uid, db: database, ref: (path) => ref(uid, path, uid) }
}
const taskSet = (count, prefix = 't') => Array.from({ length: count }, (_, i) =>
  ({ id: `${prefix}${i}`, text: `Task ${i}`, completed: i % 2 === 0 }))
const listSet = (count, prefix = 't') => ({ id: 'boundary', name: 'Boundary', createdAt: 'original',
  updatedAt: 'original', order: 0, tasks: taskSet(count, prefix) })
async function rawMutation(context, parents, changes = [], revisionDelta = 1) {
  const index = (await getDoc(context.ref('lifecycle/state'))).data()
  const batch = writeBatch(context.db)
  batch.set(context.ref('lifecycle/state'), { ...index, revision: index.revision + revisionDelta, parents })
  for (const [path, data] of changes) {
    if (data === null) batch.delete(context.ref(path))
    else batch.set(context.ref(path), data)
  }
  return batch.commit()
}

test('adversarial stale/missing revision, forged manifest, and wrong task order roll back every write', async () => {
  const c = await freshCase()
  await c.account.replaceDatedTasks('2026-11-01', taskSet(2), null, 0)
  const index = (await getDoc(c.ref('lifecycle/state'))).data()
  const original = (await getDoc(c.ref('days/2026-11-01/tasks/t0'))).data()
  for (const delta of [0, -1, 2]) await denied(rawMutation(c, index.parents,
    [['days/2026-11-01/tasks/t0', { ...original, text: 'Rejected' }]], delta))
  for (const patch of [{ ownerId: 'bob' }, { parents: [] }, { revision: 1.5 }, { extra: true }]) {
    await denied(rawSetDoc(c.ref('lifecycle/state'), { ...index, revision: index.revision + 1, ...patch }))
  }
  const missing = { ...index }; delete missing.revision
  await denied(rawSetDoc(c.ref('lifecycle/state'), missing))
  await denied(rawMutation(c, index.parents, [['days/2026-11-01/tasks/t0', { ...original, order: 1 }]]))
  await denied(rawUpdateDoc(c.ref('days/2026-11-01/tasks/t0'), { text: 'No revision' }))
  await denied(rawSetDoc(c.ref('lifecycle/other'), index))
  assert.deepEqual((await getDoc(c.ref('lifecycle/state'))).data(), index)
  assert.deepEqual((await getDoc(c.ref('days/2026-11-01/tasks/t0'))).data(), original)
  c.account.dispose()
})

test('indexed child without physical parent, malformed date shapes, and arbitrary nesting are denied', async () => {
  const c = await freshCase()
  const full = (data) => ({ schemaVersion: 1, ownerId: c.uid, ...data })
  await denied(rawMutation(c, { 'savedLists/absent': ['t0'] }, [
    ['savedLists/absent/tasks/t0', full({ ...taskSet(1)[0], order: 0 })],
  ]))
  for (const dateKey of ['2026-13-01', '2026-00-01', '2026-01-32', '2026-1-01', 'not-a-date']) {
    await denied(rawMutation(c, { [`days/${dateKey}`]: [] }, [
      [`days/${dateKey}`, full({ dateKey, currentListId: null })],
    ]))
  }
  for (const path of ['savedLists/a/tasks/t/children/c', 'lifecycle/state/children/c']) {
    await denied(rawSetDoc(c.ref(path), full({})))
  }
  assert.equal(await rev(c.account), 0)
  c.account.dispose()
})

// These are vulnerability regression probes, NOT desired security guarantees.
// Assert actual acceptance so a rules fix forces review of the documented gap.
test('KNOWN GAP: owner can forge manifest entries, duplicate membership and exceed the client document bound', async () => {
  const c = await freshCase()
  for (const parents of [{ arbitrary: 7 }, { 'savedLists/absent': ['same', 'same'] },
    { 'savedLists/absent': Array.from({ length: 350 }, (_, i) => `t${i}`) }]) {
    await rawMutation(c, parents)
    assert.deepEqual((await getDoc(c.ref('lifecycle/state'))).data().parents, parents)
    await assert.rejects(c.account.loadAccount())
  }
  c.account.dispose()
})

test('KNOWN GAP: manifest-only reorder and parent deletion can leave unchanged or orphaned children', async () => {
  const c = await freshCase()
  await c.account.replaceDatedTasks('2026-11-01', taskSet(2), null, 0)
  await rawMutation(c, { 'days/2026-11-01': ['t1', 't0'] })
  assert.equal((await getDoc(c.ref('days/2026-11-01/tasks/t0'))).data().order, 0)
  await assert.rejects(c.account.loadAccount(), { code: 'taskly/integrity' })
  await rawMutation(c, {}, [['days/2026-11-01', null]])
  assert.equal((await getDoc(c.ref('days/2026-11-01/tasks/t0'))).exists(), true)
  // A valid empty manifest cannot reveal orphaned documents.
  assert.deepEqual((await c.account.loadAccount()).aggregates, {})
  c.account.dispose()
})

test('impossible calendar days, dangling list references and indexed total-count mismatches are denied atomically', async () => {
  const c = await freshCase()
  const full = (data) => ({ schemaVersion: 1, ownerId: c.uid, ...data })
  for (const dateKey of ['2026-02-30', '2026-02-29', '1900-02-29', '2026-04-31']) {
    await denied(rawMutation(c, { [`days/${dateKey}`]: [] }, [
      [`days/${dateKey}`, full({ dateKey, currentListId: null })],
    ]))
  }
  await denied(rawMutation(c, { 'days/2026-11-01': [] }, [
    ['days/2026-11-01', full({ dateKey: '2026-11-01', currentListId: 'absent' })],
  ]))
  await denied(rawMutation(c, { 'finishedDays/bad': [] }, [
    ['finishedDays/bad', full({ id: 'bad', dateKey: '2026-11-01', date: 'arbitrary', createdAt: 'time',
      totalCount: 5, completedCount: 5, order: 0 })],
  ]))
  assert.equal(await rev(c.account), 0)
  assert.equal((await getDoc(c.ref('finishedDays/bad'))).exists(), false)
  for (const dateKey of ['2000-02-29', '2028-02-29', '2026-04-30']) {
    await c.account.replaceDatedTasks(dateKey, [], null, await rev(c.account))
  }
  c.account.dispose()
})

test('written parents reject duplicate or oversized membership and user-root deletion is blocked', async () => {
  const c = await freshCase()
  const full = (data) => ({ schemaVersion: 1, ownerId: c.uid, ...data })
  for (const ids of [['same', 'same'], Array.from({ length: 349 }, (_, i) => `t${i}`)]) {
    await denied(rawMutation(c, { 'days/2026-11-01': ids }, [
      ['days/2026-11-01', full({ dateKey: '2026-11-01', currentListId: null })],
    ]))
  }
  await rawSetDoc(c.ref(''), full({}))
  await denied(rawDeleteDoc(c.ref('')))
  assert.equal(await rev(c.account), 0)
  c.account.dispose()
})

test('reference checks use final state: creating a list with a day succeeds but deleting its target in the same commit denies', async () => {
  const c = await freshCase()
  await c.account.saveListForDate(listSet(1), '2026-11-01', 0)
  const index = (await getDoc(c.ref('lifecycle/state'))).data()
  const day = (await getDoc(c.ref('days/2026-11-01'))).data()
  await denied(rawMutation(c, { 'days/2026-11-01': [] }, [
    ['savedLists/boundary', null], ['savedLists/boundary/tasks/t0', null],
    ['days/2026-11-01', day],
  ]))
  assert.equal(await rev(c.account), index.revision)
  assert.equal(await c.account.loadCurrentList('2026-11-01'), 'boundary')
  await c.account.deleteSavedList('boundary', index.revision)
  assert.equal(await c.account.loadCurrentList('2026-11-01'), null)
  c.account.dispose()
})

test('KNOWN GAP: manifest-only revision bumps, fabricated counts and completion metadata remain forgeable', async () => {
  const c = await freshCase()
  await rawMutation(c, {}) // Exact +1 alone is not proof of a real mutation.
  assert.equal(await rev(c.account), 1)
  const full = (data) => ({ schemaVersion: 1, ownerId: c.uid, ...data })
  await rawMutation(c, { 'finishedDays/forged': ['missing'] }, [
    ['finishedDays/forged', full({ id: 'forged', dateKey: '2026-11-01', date: '2026-11-01',
      createdAt: 'time', order: 0, totalCount: 1, completedCount: 1 })],
  ])
  assert.equal((await getDoc(c.ref('finishedDays/forged/tasks/missing'))).exists(), false)
  await assert.rejects(c.account.loadAccount(), { code: 'taskly/integrity' })
  c.account.dispose()
})

test('KNOWN GAP: changing an unwritten day target or finished completion metadata bypasses aggregate consistency', async () => {
  const c = await freshCase()
  await c.account.saveListForDate(listSet(0), '2026-11-01', 0)
  const index = (await getDoc(c.ref('lifecycle/state'))).data()
  await rawMutation(c, { 'days/2026-11-01': [] }, [['savedLists/boundary', null]])
  await assert.rejects(c.account.loadAccount(), { code: 'taskly/integrity' })
  // Restore only this disposable fixture, explicitly, to isolate the next probe.
  const { tasks, ...metadata } = listSet(0)
  await rawMutation(c, index.parents, [['savedLists/boundary', { ...metadata, schemaVersion: 1, ownerId: c.uid }]])
  await c.account.createFinishedDay({ id: 'counts', dateKey: '2026-11-01', date: '2026-11-01', createdAt: 'time',
    order: 0, tasks: taskSet(1), totalCount: 1, completedCount: 1 })
  const state = (await getDoc(c.ref('lifecycle/state'))).data()
  const finished = (await getDoc(c.ref('finishedDays/counts'))).data()
  await rawMutation(c, state.parents, [['finishedDays/counts', { ...finished, completedCount: 0 }]])
  await assert.rejects(c.account.loadAccount(), { code: 'taskly/integrity' })
  c.account.dispose()
})

test('350 indexed documents: large Saved List create/replace/cascade succeed, 351 rejects intact', async () => {
  const c = await freshCase()
  await c.account.saveList(listSet(348)) // manifest + parent + 348 children
  assert.equal((await c.account.loadSavedLists())[0].tasks.length, 348)
  const version = await rev(c.account)
  await assert.rejects(c.account.saveList({ ...listSet(0), id: 'overflow' }), /bounded lifecycle limit/)
  assert.equal(await rev(c.account), version)
  await c.account.replaceSavedList({ ...listSet(348), name: 'Replaced' }, version)
  assert.equal((await c.account.loadSavedLists())[0].name, 'Replaced')
  await c.account.deleteSavedList('boundary', await rev(c.account))
  assert.equal((await getDocs(collection(c.db, `users/${c.uid}/savedLists/boundary/tasks`))).size, 0)
  assert.deepEqual((await c.account.loadAccount()).aggregates, {})
  c.account.dispose()
})

test('400 document union succeeds and 401 rejects snapshot replacement without partial changes', async () => {
  const c = await freshCase()
  await c.account.saveList(listSet(199, 'old'))
  await c.account.replaceSavedList(listSet(199, 'new'), await rev(c.account)) // 1+1+199+199 = 400
  const before = await c.account.loadSavedLists()
  const version = await rev(c.account)
  await assert.rejects(c.account.replaceSavedList(listSet(200, 'third'), version), /safe transaction limit/)
  assert.deepEqual(await c.account.loadSavedLists(), before)
  assert.equal(await rev(c.account), version)
  assert.equal((await getDocs(collection(c.db, `users/${c.uid}/savedLists/boundary/tasks`))).size, 199)
  c.account.dispose()
})

test('large Finished Day create/cascade and numerous shallow collections reach 350 indexed documents', async () => {
  const c = await freshCase()
  await c.account.createFinishedDay({ id: 'large', dateKey: '2026-11-01', date: '2026-11-01', createdAt: 'time',
    order: 0, tasks: taskSet(348), totalCount: 348, completedCount: 174 })
  assert.equal((await c.account.loadFinishedDays())[0].totalCount, 348)
  await c.account.deleteFinishedDay('large', await rev(c.account))
  assert.equal((await getDocs(collection(c.db, `users/${c.uid}/finishedDays/large/tasks`))).size, 0)
  // Seed a valid client-compatible account through owner rules, not Admin bypass.
  const parents = {}; const changes = []
  for (let i = 0; i < 174; i++) {
    const parent = `savedLists/p${i}`; parents[parent] = ['t0']
    const { tasks, ...metadata } = { ...listSet(1), id: `p${i}` }
    changes.push([parent, { ...metadata, schemaVersion: 1, ownerId: c.uid }],
      [`${parent}/tasks/t0`, { ...tasks[0], order: 0, schemaVersion: 1, ownerId: c.uid }])
  }
  parents['savedLists/empty'] = []
  const { tasks, ...empty } = { ...listSet(0), id: 'empty' }
  changes.push(['savedLists/empty', { ...empty, schemaVersion: 1, ownerId: c.uid }])
  await rawMutation(c, parents, changes)
  assert.equal((await c.account.loadSavedLists()).length, 175)
  await assert.rejects(c.account.saveList({ ...listSet(0), id: 'too-many' }), /bounded lifecycle limit/)
  assert.equal((await c.account.loadSavedLists()).length, 175)
  c.account.dispose()
})

test('atomic Finish Day union boundary: 198 tasks succeed at 399 paths, 199 reject at 401 intact', async () => {
  const c = await freshCase()
  const dateKey = '2026-11-01'
  await c.account.replaceDatedTasks(dateKey, taskSet(199), null, 0)
  const version = await rev(c.account)
  const metadata = { id: 'boundary-finish', createdAt: 'time', order: 0 }
  await assert.rejects(c.account.finishDay(dateKey, metadata, version), /safe transaction limit/)
  assert.equal(await rev(c.account), version)
  assert.equal((await c.account.loadTasks(dateKey)).length, 199)
  assert.equal((await getDoc(c.ref('finishedDays/boundary-finish'))).exists(), false)
  assert.equal((await getDocs(collection(c.db, `users/${c.uid}/finishedDays/boundary-finish/tasks`))).size, 0)
  await c.account.replaceDatedTasks(dateKey, taskSet(198), null, version)
  await c.account.finishDay(dateKey, metadata, await rev(c.account))
  assert.equal((await c.account.loadFinishedDays())[0].tasks.length, 198)
  assert.deepEqual(await c.account.loadTasks(dateKey), [])
  c.account.dispose()
})

test('same-task edits, Saved List replacement and simultaneous Finish Day each have one revision winner', async () => {
  const c = await freshCase()
  // Separate Firebase app/transport, same authenticated UID.
  const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: 'second' }, `${c.uid}-second`)
  const database = initializeFirestore(app, {})
  connectFirestoreEmulator(database, hostname, Number(port), { mockUserToken: { sub: c.uid, user_id: c.uid } })
  clients.set(`${c.uid}-second`, { app, db: database })
  const second = accountClient(`${c.uid}-second`, c.uid)
  const a = c.account; const b = second.account
  await a.replaceDatedTasks('2026-11-01', taskSet(2), null, 0)
  const race = async (operations) => {
    const version = await rev(a)
    const results = await Promise.allSettled(operations.map((operation) => operation(version)))
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
    assert.equal(results.find(({ status }) => status === 'rejected').reason.code, 'taskly/conflict')
    assert.equal(await rev(a), version + 1)
  }
  await race([(r) => a.editTask('2026-11-01', 't0', 'A', r), (r) => b.editTask('2026-11-01', 't0', 'B', r)])
  assert.ok(['A', 'B'].includes((await a.loadTasks('2026-11-01'))[0].text))
  for (let i = 0; i < 12; i++) {
    await a.reorderTasks('2026-11-01', i % 2 ? ['t0', 't1'] : ['t1', 't0'], await rev(a))
  }
  assert.deepEqual((await a.loadTasks('2026-11-01')).map(({ id, order }) => [id, order]), [['t0', 0], ['t1', 1]])
  await a.saveList(listSet(2))
  await race([(r) => a.replaceSavedList(listSet(3, 'a'), r), (r) => b.replaceSavedList(listSet(4, 'b'), r)])
  const saved = (await a.loadSavedLists())[0]
  assert.ok(saved.tasks.every(({ id }) => id.startsWith(saved.tasks.length === 3 ? 'a' : 'b')))
  await race([(r) => a.finishDay('2026-11-01', { id: 'finish-a', createdAt: 'time', order: 0 }, r),
    (r) => b.finishDay('2026-11-01', { id: 'finish-b', createdAt: 'time', order: 0 }, r)])
  assert.equal((await a.loadFinishedDays()).length, 1)
  assert.deepEqual(await a.loadTasks('2026-11-01'), [])
  a.dispose(); b.dispose()
})

test('interrupted pre-submit operation retries once; lost acknowledgment requires reload and blocks duplicate finish', async () => {
  const c = await freshCase()
  await c.account.replaceDatedTasks('2026-11-01', taskSet(2), null, 0)
  const version = await rev(c.account)
  const metadata = { id: 'uncertain', createdAt: 'time', order: 0 }
  const interrupted = accountClient(c.uid, c.uid, (transport) => ({ ...transport,
    async transact() { throw new Error('Interrupted before submission') },
  }))
  await assert.rejects(interrupted.account.finishDay('2026-11-01', metadata, version), /Interrupted/)
  assert.equal(await rev(c.account), version)
  assert.equal((await c.account.loadTasks('2026-11-01')).length, 2)
  // Inject only after a mutation; finishDay first reads a transactional view.
  let submitted = 0
  const late = accountClient(c.uid, c.uid, (transport) => ({ ...transport,
    async transact(paths, plan) {
      let mutated = false
      await transport.transact(paths, (values) => {
        const changes = plan(values); mutated = changes.length > 0; return changes
      })
      if (mutated) { submitted++; throw new Error('Lost acknowledgment') }
    },
  }))
  await assert.rejects(late.account.finishDay('2026-11-01', metadata, version), /Lost acknowledgment/)
  assert.equal(submitted, 1)
  assert.equal(await rev(c.account), version + 1)
  assert.equal((await c.account.loadFinishedDays()).length, 1)
  await assert.rejects(c.account.finishDay('2026-11-01', metadata, version), { code: 'taskly/conflict' })
  assert.deepEqual(await c.account.loadTasks('2026-11-01'), [])
  c.account.dispose(); interrupted.account.dispose(); late.account.dispose()
})

test('account switch during a real pending commit suppresses success while preserving original UID scope', async () => {
  const c = await freshCase()
  await c.account.saveList(listSet(2))
  let signalCommitted, release
  const committed = new Promise((resolve) => { signalCommitted = resolve })
  const held = new Promise((resolve) => { release = resolve })
  const pending = accountClient(c.uid, c.uid, (transport) => ({ ...transport,
    async transact(...args) { await transport.transact(...args); signalCommitted(); await held },
  }))
  const writing = pending.account.replaceSavedList(listSet(3, 'replacement'), await rev(c.account))
  await committed
  pending.logout() // Invalidates permanently, as switching to another UID does.
  release()
  await assert.rejects(writing, /session has changed/)
  assert.equal((await c.account.loadSavedLists())[0].tasks.length, 3)
  await denied(getDoc(doc(clients.get('bob').db, `users/${c.uid}/savedLists/boundary`)))
  c.account.dispose(); pending.account.dispose()
})

test('two independent devices racing to reorder have one winner and no stale silent overwrite', async () => {
  const a = accountClient()
  const b = accountClient('alice-device2')
  const dateKey = '2026-12-01'
  await a.account.createTask(dateKey, { id: 'a', text: 'A', completed: false }, 0)
  await a.account.createTask(dateKey, { id: 'b', text: 'B', completed: true }, 1)
  const version = await rev(a.account)
  const results = await Promise.allSettled([
    a.account.reorderTasks(dateKey, ['b', 'a'], version),
    b.account.reorderTasks(dateKey, ['a', 'b'], version),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'taskly/conflict')
  assert.equal(await rev(a.account), version + 1)
  assert.deepEqual((await a.account.loadTasks(dateKey)).map(({ order }) => order), [0, 1])
  a.account.dispose(); b.account.dispose()
})

test('snapshot replacement and cascading deletion stay coherent during competing writes', async () => {
  const a = accountClient()
  const b = accountClient('alice-device2')
  const list = { id: 'replace-me', name: 'Original', createdAt: 'original', updatedAt: 'original', order: 0,
    tasks: [{ id: 'old', text: 'Old', completed: true }] }
  await a.account.saveList(list)
  await a.account.setCurrentList('2026-12-02', list.id)
  const version = await rev(a.account)
  const replacement = { ...list, name: 'New', updatedAt: 'later', tasks: [{ id: 'new', text: 'New', completed: false }] }
  const results = await Promise.allSettled([
    a.account.replaceSavedList(replacement, version), b.account.deleteSavedList(list.id, version),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'taskly/conflict')
  const snapshot = (await a.account.loadSavedLists()).find(({ id }) => id === list.id)
  if (snapshot) {
    assert.deepEqual(snapshot.tasks.map(({ id }) => id), ['new'])
    assert.equal(await a.account.loadCurrentList('2026-12-02'), list.id)
    await a.account.deleteSavedList(list.id, await rev(a.account))
  }
  assert.equal(await a.account.loadCurrentList('2026-12-02'), null)
  assert.equal((await getDocs(collection(db, `users/alice/savedLists/${list.id}/tasks`))).empty, true)
  assert.equal((await getDoc(ref('alice', `savedLists/${list.id}`))).exists(), false)
  a.account.dispose(); b.account.dispose()
})

test('Finish Day and competing edit cannot produce a mixed snapshot or partial clear', async () => {
  const a = accountClient()
  const b = accountClient('alice-device2')
  const dateKey = '2026-12-03'
  await a.account.createTask(dateKey, { id: 'finish', text: 'Original', completed: true }, 0)
  const version = await rev(a.account)
  const metadata = { id: 'finish-atomic', createdAt: 'original', order: 0 }
  const results = await Promise.allSettled([
    a.account.finishDay(dateKey, metadata, version), b.account.editTask(dateKey, 'finish', 'Edited'),
  ])
  const finished = (await a.account.loadFinishedDays()).find(({ id }) => id === metadata.id)
  if (finished) {
    assert.equal(results[0].status, 'fulfilled')
    assert.equal(results[1].status, 'rejected')
    assert.equal(finished.dateKey, dateKey)
    assert.equal(finished.tasks[0].text, 'Original')
    assert.equal(finished.tasks[0].completed, true)
    assert.equal(finished.completedCount, 1)
    assert.equal((await getDocs(collection(db, `users/alice/days/${dateKey}/tasks`))).empty, true)
  } else {
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[1].status, 'fulfilled')
    assert.equal((await a.account.loadTasks(dateKey))[0].text, 'Edited')
    await a.account.finishDay(dateKey, metadata, await rev(a.account))
  }
  await assert.rejects(a.account.finishDay(dateKey, metadata, version), { code: 'taskly/conflict' })
  await a.account.deleteFinishedDay(metadata.id, await rev(a.account))
  assert.equal((await getDocs(collection(db, `users/alice/finishedDays/${metadata.id}/tasks`))).empty, true)
  a.account.dispose(); b.account.dispose()
})

test('offline server transactions fail without queueing a snapshot replacement', async () => {
  const a = accountClient('alice-device2')
  const version = await rev(a.account)
  const theme = await a.account.loadTheme()
  await disableNetwork(clients.get('alice-device2').db)
  try {
    await assert.rejects(a.account.reorderTasks('2026-12-01', ['a', 'b'], version))
    await assert.rejects(a.account.saveTheme('ocean')) // Exercises an actual SDK transaction offline.
  } finally { await enableNetwork(clients.get('alice-device2').db) }
  assert.equal(await rev(a.account), version)
  assert.equal(await a.account.loadTheme(), theme)
  a.account.dispose()
})

test('new rules reject legacy bypass writes, unindexed children and lifecycle reset or cross-account access', async () => {
  const indexRef = ref('alice', 'lifecycle/state')
  const index = (await getDoc(indexRef)).data()
  await denied(rawDeleteDoc(indexRef))
  await denied(rawSetDoc(indexRef, { ...index, revision: 0, parents: {} }))
  await denied(getDoc(ref('bob', 'lifecycle/state')))
  await denied(rawSetDoc(ref('alice', 'days/2026-12-01/tasks/a'),
    { schemaVersion: 1, ownerId: 'alice', id: 'a', text: 'Bypass', completed: false, order: 0 }))
  const batch = writeBatch(db)
  batch.set(indexRef, { ...index, revision: index.revision + 1 })
  batch.set(ref('alice', 'days/2026-12-01/tasks/unindexed'),
    { schemaVersion: 1, ownerId: 'alice', id: 'unindexed', text: 'Unindexed', completed: false, order: 0 })
  await denied(batch.commit())
  assert.equal((await getDoc(indexRef)).data().revision, index.revision)
  await denied(updateDoc(ref('alice', 'days/2026-12-01/tasks/a'), { order: 100 }))
})

test('bounded multi-task snapshot replacement and cascade remain within cached rules access limits', async () => {
  const { account } = accountClient()
  const list = { id: 'many-tasks', name: 'Many', createdAt: 'original', updatedAt: 'original', order: 0,
    tasks: Array.from({ length: 25 }, (_, i) => ({ id: `many-${i}`, text: `Task ${i}`, completed: i % 2 === 0 })) }
  await account.saveList(list)
  await account.replaceSavedList({ ...list, tasks: [...list.tasks].reverse() }, await rev(account))
  assert.deepEqual((await account.loadSavedLists()).find(({ id }) => id === list.id).tasks.map(({ id }) => id),
    [...list.tasks].reverse().map(({ id }) => id))
  await account.deleteSavedList(list.id, await rev(account))
  assert.equal((await getDocs(collection(db, `users/alice/savedLists/${list.id}/tasks`))).empty, true)
  account.dispose()
})

test('a server-rejected Finish Day has no partial snapshot or active task deletion and can be retried', async () => {
  const good = accountClient()
  const dateKey = '2026-12-04'
  await good.account.createTask(dateKey, { id: 'retained', text: 'Retained', completed: false }, 0)
  const version = await rev(good.account)
  const metadata = { id: 'retry-finish', createdAt: 'original', order: 0 }
  const broken = accountClient('alice', 'alice', (transport) => ({ ...transport,
    transact(paths, plan) {
      return transport.transact(paths, (values) => plan(values).map((change) =>
        change.path === 'users/alice/finishedDays/retry-finish'
          ? { ...change, data: { ...change.data, extraField: true } } : change))
    },
  }))
  await denied(broken.account.finishDay(dateKey, metadata, version))
  assert.equal(await rev(good.account), version)
  assert.equal((await good.account.loadTasks(dateKey))[0].id, 'retained')
  assert.equal((await getDoc(ref('alice', 'finishedDays/retry-finish'))).exists(), false)
  assert.equal((await getDocs(collection(db, 'users/alice/finishedDays/retry-finish/tasks'))).empty, true)
  await good.account.finishDay(dateKey, metadata, version)
  assert.deepEqual(await good.account.loadTasks(dateKey), [])
  assert.equal((await good.account.loadFinishedDays()).find(({ id }) => id === metadata.id).tasks[0].id, 'retained')
  good.account.dispose(); broken.account.dispose()
})

for (const family of ['savedLists', 'finishedDays']) {
  test(`KNOWN GAP: forged ${family} deletion leaves physical snapshot children`, async () => {
    const c = await freshCase()
    if (family === 'savedLists') await c.account.saveList(listSet(1))
    else await c.account.createFinishedDay({ id: 'boundary', dateKey: '2026-11-01', date: '2026-11-01',
      createdAt: 'time', order: 0, tasks: taskSet(1), totalCount: 1, completedCount: 1 })
    await rawMutation(c, {}, [[`${family}/boundary`, null]])
    assert.equal((await getDoc(c.ref(`${family}/boundary/tasks/t0`))).exists(), true)
    assert.deepEqual((await c.account.loadAccount()).aggregates, {})
    c.account.dispose()
  })
}

test('staging admission fails closed for absent, expired, disabled, malformed and revoked roster entries', { skip: !admission }, async () => {
  const c = await freshCase()
  const path = 'preferences/general'
  const value = { schemaVersion: 1, ownerId: c.uid, themeId: 'forest' }
  await rawSetDoc(c.ref(path), value)
  const rosterRef = doc(c.db, `stagingTesters/${c.uid}`)
  await denied(getDoc(rosterRef))
  await denied(rawSetDoc(rosterRef, { enabled: true, expiresAt: new Date(Date.now() + 3600000) }))
  await denied(rawDeleteDoc(rosterRef))
  for (const fields of [null, {}, { enabled: { booleanValue: true } },
    { ...admittedFields(), enabled: { booleanValue: false } },
    { ...admittedFields(), expiresAt: { timestampValue: '2000-01-01T00:00:00Z' } },
    { ...admittedFields(), expiresAt: { stringValue: '2099-01-01' } }]) {
    await roster(c.uid, fields)
    await denied(getDoc(c.ref(path)))
    await denied(rawSetDoc(c.ref(path), value))
    await denied(rawDeleteDoc(c.ref(path)))
    await denied(getDocs(collection(c.db, `users/${c.uid}/days`)))
    await denied(rawUpdateDoc(c.ref('lifecycle/state'), { revision: 1 }))
  }
  await roster(c.uid, admittedFields())
  assert.deepEqual((await getDoc(c.ref(path))).data(), value)
  await c.account.replaceDatedTasks('2026-11-01', taskSet(1), null, 0)
  await roster(c.uid, null)
  await denied(c.account.editTask('2026-11-01', 't0', 'Revoked'))
  await denied(getDoc(c.ref('days/2026-11-01/tasks/t0')))
  c.account.dispose()
})

test('revoking an admitted UID gates every existing document family and does not admit other owners', { skip: !admission }, async () => {
  await roster('alice', null)
  try {
    for (const { path, data } of [...fixtures, { path: 'lifecycle/state', data: {} }]) {
      await denied(getDoc(ref('alice', path)))
      await denied(rawSetDoc(ref('alice', path), data))
      await denied(rawDeleteDoc(ref('alice', path)))
    }
  } finally { await roster('alice', admittedFields()) }
  await denied(getDoc(ref('bob', 'preferences/general')))
  assert.equal((await getDoc(ref('alice', 'preferences/general'))).exists(), true)
})
