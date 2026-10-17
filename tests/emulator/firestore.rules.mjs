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
