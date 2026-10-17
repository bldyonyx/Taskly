// Explicit emulator-only suite; not part of the default node --test discovery.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { initializeFirestore, connectFirestoreEmulator, doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, terminate } from 'firebase/firestore'
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
for (const uid of ['alice', 'bob', 'guest']) {
  const app = initializeApp({ projectId, apiKey: 'emulator-only', appId: `test-${uid}` }, `rules-${uid}`)
  const db = initializeFirestore(app, {})
  connectFirestoreEmulator(db, hostname, Number(port), uid === 'guest' ? {} : { mockUserToken: { sub: uid, user_id: uid } })
  clients.set(uid, { app, db })
}
const db = clients.get('alice').db
const ref = (client, path, uid = 'alice') => doc(clients.get(client).db, `users/${uid}${path ? `/${path}` : ''}`)
const denied = (operation) => assert.rejects(operation, (error) => error.code === 'permission-denied')
const fixtures = documents()

before(async () => {
  const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE', signal: AbortSignal.timeout(5000) })
  assert.equal(response.ok, true)
  // Rules must already be loaded by firebase emulators:exec/start using firebase.json.
  for (const { path, data } of fixtures) await setDoc(ref('alice', path), data)
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
  await account.reorderTasks(dateKey, ['two', 'one'])
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
  await denied(transport.transact(['users/alice/preferences/general', `users/alice/${listPath}`], () => [
    { path: 'users/alice/preferences/general', data: { schemaVersion: 1, ownerId: 'alice', themeId: 'forest' } },
    { path: `users/alice/${listPath}`, data: { ...original, createdAt: 'changed' } },
  ]))
  assert.equal(await account.loadTheme(), 'rose')
  await account.deleteTask(dateKey, 'one')
  assert.equal((await account.loadTasks(dateKey)).length, 1)
  account.dispose()
})
