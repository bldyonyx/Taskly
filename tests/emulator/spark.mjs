// Candidate rules only; never discovered by npm test. Demo emulators required.
import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { initializeFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc, terminate } from 'firebase/firestore'
import { sparkFixture } from '../../tools/fixtures/spark.mjs'
const host = process.env.FIRESTORE_EMULATOR_HOST
assert.match(host ?? '', /^127\.0\.0\.1:\d+$/)
assert.equal(process.env.GCLOUD_PROJECT, 'demo-taskly-trusted')
const project = 'demo-taskly-trusted'
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`
async function put(path, fields) {
  const response = await fetch(`${base}/${path}`, { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) })
  assert.equal(response.ok, true)
}
const strings = data => Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value }]))
test('candidate rules enforce admission, UID, all writes and unsupported paths', async () => {
  const fixture = sparkFixture()
  await put(`users/${fixture.uid}`, strings(fixture.documents[0].data))
  const apps = []
  async function client(uid) {
    const app = initializeApp({ projectId: project, apiKey: 'emulator-only', appId: 'spark-local' }, `spark-${uid ?? 'guest'}`)
    const db = initializeFirestore(app, {})
    connectFirestoreEmulator(db, '127.0.0.1', Number(host.split(':')[1]), uid ? { mockUserToken: { sub: uid, user_id: uid } } : {})
    apps.push({ app, db }); return db
  }
  const denied = operation => assert.rejects(operation, error => error.code === 'permission-denied')
  try {
    const alice = await client(fixture.uid), bob = await client('synthetic-bob'), guest = await client()
    const root = db => doc(db, `users/${fixture.uid}`)
    await denied(getDocFromServer(root(alice)))
    const admission = async (enabled, expiresAt) => put(`stagingTesters/${fixture.uid}`, { enabled: { booleanValue: enabled }, expiresAt: { timestampValue: new Date(expiresAt).toISOString() } })
    await admission(true, Date.now() + 1800000)
    assert.equal((await getDocFromServer(root(alice))).exists(), true)
    await denied(getDocFromServer(root(bob))); await denied(getDocFromServer(root(guest)))
    for (const path of ['', '/days/2026-10-29', '/days/2026-10-29/tasks/x', '/lifecycle/state', '/preferences/general']) await denied(setDoc(doc(alice, `users/${fixture.uid}${path}`), {}))
    for (const path of ['lifecycle/unknown', 'preferences/unknown', 'imports/x', 'trusted/state', 'unknown/x']) await denied(getDocFromServer(doc(alice, `users/${fixture.uid}/${path}`)))
    await denied(setDoc(doc(alice, `stagingTesters/${fixture.uid}`), {}))
    await denied(getDocFromServer(doc(alice, `stagingTesters/${fixture.uid}`)))
    for (const [enabled, expiry] of [[false, Date.now() + 1800000], [true, Date.now() - 1000], [true, Date.now() + 7200000]]) {
      await admission(enabled, expiry); await denied(getDocFromServer(root(alice)))
    }
    await put(`stagingTesters/${fixture.uid}`, { enabled: { booleanValue: true } })
    await denied(getDocFromServer(root(alice)))
  } finally { for (const { app, db } of apps) { await terminate(db); await deleteApp(app) } }
})
