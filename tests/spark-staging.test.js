import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getApps } from 'firebase/app'
import { resolveConfig } from 'vite'
import { readOnlyShape, assertReadOnlyActivation, createReadOnlyReader, APPROVED_READ_ONLY_STAGING } from '../src/staging/read-only.js'
import { createReadOnlyRuntime } from '../src/staging/read-only-runtime.js'
import { sparkFixture } from '../tools/fixtures/spark.mjs'
const env = { TASKLY_STAGING_ENV: 'staging', TASKLY_STAGING_PROJECT_ID: 'taskly-synthetic',
  TASKLY_STAGING_AUTH_DOMAIN: 'taskly-synthetic.firebaseapp.com', TASKLY_STAGING_API_KEY: `AIza${'a'.repeat(35)}`,
  TASKLY_STAGING_APP_ID: '1:123:web:abc', TASKLY_STAGING_ORIGIN: 'https://taskly-synthetic.web.app/' }
test('read-only staging rejects missing/production config and cannot activate through flags', async () => {
  assert.equal(APPROVED_READ_ONLY_STAGING, null)
  assert.equal(readOnlyShape(env).projectId, 'taskly-synthetic')
  for (const value of [{}, { ...env, TASKLY_STAGING_PROJECT_ID: 'taskly-maya' }, { ...env, TASKLY_STAGING_APP_ID: '' }]) assert.throws(() => readOnlyShape(value))
  const before = getApps().length
  assert.throws(() => assertReadOnlyActivation({ ...env, TASKLY_STAGING_ACTIVATE: 'true' }, { origin: 'https://taskly-synthetic.web.app' }), /dormant/)
  await assert.rejects(createReadOnlyRuntime(env, { origin: 'https://taskly-synthetic.web.app' }), /dormant/)
  assert.equal(getApps().length, before)
  await assert.rejects(resolveConfig({ mode: 'staging-read-only' }, 'serve'), /Unsupported/)
  await assert.rejects(resolveConfig({ mode: 'staging-read-only' }, 'build'), /Unsupported/)
})
test('reader scopes paths, validates owners, rejects unsupported paths and stale sessions; exposes no writes', async () => {
  const fixture = sparkFixture(); let uid = fixture.uid; const paths = []
  const reader = createReadOnlyReader({ uid, currentUid: () => uid,
    read: async path => { paths.push(path); return fixture.documents[0].data },
    list: async path => { paths.push(path); return [{ id: '2026-10-29', data: fixture.documents[1].data }] },
  })
  assert.deepEqual(Object.keys(reader).sort(), ['dispose', 'list', 'read'])
  await reader.read(''); await reader.list('days')
  assert.deepEqual(paths, [`users/${uid}`, `users/${uid}/days`])
  for (const path of ['users/bob', '../bob', 'imports/x', 'trusted/state', 'stagingTesters/alice']) await assert.rejects(reader.read(path))
  uid = 'bob'; await assert.rejects(reader.list('days'), /session/)
  const wrongOwner = createReadOnlyReader({ uid: 'bob', currentUid: () => 'bob', read: async () => fixture.documents[0].data })
  await assert.rejects(wrongOwner.read(''), /owner/)
  reader.dispose(); await assert.rejects(reader.read(''), /session/)
})
test('session switch during read suppresses previous user data', async () => {
  let uid = 'synthetic-alice', release
  const reader = createReadOnlyReader({ uid, currentUid: () => uid, read: () => new Promise(resolve => { release = resolve }) })
  const pending = reader.read(''); uid = 'bob'; release(sparkFixture().documents[0].data)
  await assert.rejects(pending, /session/)
})
test('fixtures are deterministic, bounded, schema valid and contain no orphan task records', () => {
  const fixture = sparkFixture()
  assert.deepEqual(fixture, sparkFixture())
  assert.ok(fixture.documents.length <= 50)
  const paths = new Set(fixture.documents.map(row => row.path))
  for (const row of fixture.documents) if (row.path.includes('/tasks/')) assert.ok(paths.has(row.path.split('/tasks/')[0]))
  assert.throws(() => sparkFixture('../production'))
})
test('dormant browser uses read-only SDK surface and never imports guest storage or mutation adapters', () => {
  const source = ['read-only.js', 'read-only-runtime.js', 'read-only-main.js'].map(name => readFileSync(`src/staging/${name}`, 'utf8')).join('\n')
  assert.doesNotMatch(source, /localStorage|setDoc|updateDoc|deleteDoc|runTransaction|writeBatch|createUserWithEmail|trusted-account|\.\/account/)
  assert.match(source, /READ ONLY/)
  assert.match(source, /fieldset disabled/)
})
