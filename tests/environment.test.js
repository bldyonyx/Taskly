import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveConfig } from 'vite'
import { getApps } from 'firebase/app'
import { readFirebaseConfig } from '../src/js/auth/config.js'
import { selectNormalAuthConfig } from '../src/js/auth/environment.js'
import { createFirebaseAuthClient } from '../src/js/auth/firebase.js'
import { createFirebaseFirestoreRepository } from '../src/js/firestore/firebase.js'
import { assertEmulatorConfig, assertSyntheticEmail, ISOLATED_CONFIG } from '../src/isolated/config.js'
import { createIsolatedRuntime } from '../src/isolated/firebase.js'
import { validateStagingConfig, assertStagingActivation, STAGING_WRITES_ENABLED } from '../scripts/staging-contract.mjs'
import { deploymentPlan } from '../scripts/firebase-deploy.mjs'

const production = { MODE: 'production', DEV: false, VITE_FIREBASE_API_KEY: 'synthetic-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'taskly-maya.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'taskly-maya', VITE_FIREBASE_APP_ID: '1:123:web:abc' }
const staging = { TASKLY_STAGING_ENV: 'staging', TASKLY_STAGING_PROJECT_ID: 'taskly-future-staging',
  TASKLY_STAGING_AUTH_DOMAIN: 'taskly-future-staging.firebaseapp.com', TASKLY_STAGING_API_KEY: 'synthetic', TASKLY_STAGING_APP_ID: '1:456:web:def' }

test('normal builds preserve optional production Auth; local access requires two explicit settings', () => {
  assert.deepEqual(selectNormalAuthConfig(production, readFirebaseConfig), readFirebaseConfig(production))
  assert.equal(selectNormalAuthConfig({ MODE: 'production' }, readFirebaseConfig), null)
  assert.equal(selectNormalAuthConfig({ ...production, DEV: true }, readFirebaseConfig), null)
  assert.throws(() => selectNormalAuthConfig({ ...production, DEV: true, VITE_ALLOW_PRODUCTION_AUTH: 'true' }, readFirebaseConfig))
  assert.ok(selectNormalAuthConfig({ ...production, DEV: true, VITE_ALLOW_PRODUCTION_AUTH: 'true', VITE_FIREBASE_ENV: 'production' }, readFirebaseConfig))
  for (const patch of [{ VITE_FIREBASE_ENV: 'staging' }, { VITE_FIREBASE_PROJECT_ID: 'other-project' }, { VITE_FIREBASE_AUTH_DOMAIN: 'other.firebaseapp.com' }, { VITE_FIREBASE_APP_ID: 'invalid' }]) {
    assert.throws(() => selectNormalAuthConfig({ ...production, ...patch }, readFirebaseConfig))
  }
  assert.equal(selectNormalAuthConfig({ ...production, MODE: 'cloud-test' }, readFirebaseConfig), null)
  assert.throws(() => selectNormalAuthConfig({ ...production, MODE: 'staging' }, readFirebaseConfig))
})

test('production Auth validates before SDK calls and preserves its complete Auth interface', async () => {
  const calls = []
  const config = readFirebaseConfig(production)
  const app = { name: '[DEFAULT]', options: config }
  const auth = { useDeviceLanguage: () => calls.push('language') }
  const sdk = { getApps: () => [], initializeApp: () => { calls.push('init'); return app }, getAuth: () => auth }
  for (const name of ['onAuthStateChanged', 'createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signOut', 'sendPasswordResetEmail']) sdk[name] = (...args) => { assert.equal(args[0], auth); calls.push(name) }
  assert.throws(() => createFirebaseAuthClient({ ...config, projectId: 'wrong' }, sdk))
  assert.deepEqual(calls, [])
  const client = createFirebaseAuthClient(config, sdk)
  client.subscribe(() => {}); await client.signup('synthetic@example.test', 'synthetic'); await client.login('synthetic@example.test', 'synthetic'); await client.logout(); await client.reset('synthetic@example.test')
  assert.deepEqual(calls, ['init', 'language', 'onAuthStateChanged', 'createUserWithEmailAndPassword', 'signInWithEmailAndPassword', 'signOut', 'sendPasswordResetEmail'])
  sdk.getApps = () => [{ ...app, options: { ...config, appId: 'mismatch' } }]
  assert.throws(() => createFirebaseAuthClient(config, sdk), /does not match/)
})

test('missing, production and remote emulator configs fail before Firebase initialization or requests', async () => {
  const before = getApps().length
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = () => { requests++; throw new Error('Network forbidden') }
  try {
    const guard = { enabled: true, dev: true, mode: 'cloud-test', hostname: '127.0.0.1' }
    assert.equal(assertEmulatorConfig(ISOLATED_CONFIG), ISOLATED_CONFIG)
    for (const config of [null, {}, { ...ISOLATED_CONFIG, projectId: 'taskly-maya' }, { ...ISOLATED_CONFIG, environment: 'staging' }, { ...ISOLATED_CONFIG, authHost: 'firebase.google.com' }, { ...ISOLATED_CONFIG, firestorePort: undefined }]) {
      assert.throws(() => assertEmulatorConfig(config))
      await assert.rejects(createIsolatedRuntime(guard, config))
    }
    await assert.rejects(createFirebaseFirestoreRepository({ app: { options: { projectId: 'taskly-maya' } } }), /disabled/)
    assert.equal(getApps().length, before)
    assert.equal(requests, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('staging identity and web tuple must match; flags cannot activate unapproved projects or writes', () => {
  for (const patch of [{}, { TASKLY_STAGING_ENV: undefined }, { TASKLY_STAGING_ENV: 'production' }, { TASKLY_STAGING_PROJECT_ID: 'taskly-maya' }, { TASKLY_STAGING_AUTH_DOMAIN: production.VITE_FIREBASE_AUTH_DOMAIN }, { TASKLY_STAGING_API_KEY: '' }, { TASKLY_STAGING_APP_ID: '' }]) {
    assert.throws(() => validateStagingConfig({ ...staging, ...patch }))
    assert.throws(() => assertStagingActivation({ ...staging, ...patch, TASKLY_STAGING_WRITES_ENABLED: 'true', VITE_CLOUD_SYNC_ENABLED: 'true' }))
  }
  assert.equal(STAGING_WRITES_ENABLED, false)
})

test('emulator account actions require synthetic example.test addresses', () => {
  assert.equal(assertSyntheticEmail('alice@example.test'), 'alice@example.test')
  for (const email of ['alice@gmail.com', 'alice@example.test.evil', '', undefined]) assert.throws(() => assertSyntheticEmail(email))
})

test('Vite rejects staging and arbitrary modes before an entry can load', async () => {
  for (const mode of ['staging', 'staging-preview', 'test', 'custom']) {
    for (const command of ['serve', 'build']) await assert.rejects(resolveConfig({ mode }, command), /Unsupported Taskly mode/)
  }
  for (const mode of ['production', 'github', 'cloud-test']) {
    const config = await resolveConfig({ mode }, 'build')
    const plugin = config.plugins.find((p) => p.name === 'taskly-build-boundary')
    assert.ok(plugin)
    for (const id of ['/repo/src/isolated/firebase.js', 'C:\\repo\\src\\staging\\main.js', '/repo/scripts/staging-contract.mjs', '/repo/tools/staging/runtime.mjs', '/repo/src/shared/trusted-account.js']) {
      assert.throws(() => plugin.generateBundle.call({ getModuleIds: () => [id], error(message) { throw new Error(message) } }), /entered a normal build/)
    }
  }
})

test('deployment plans reject implicit, staging, unscoped and arbitrary targets without invoking CLI', () => {
  const approved = ['--project', 'taskly-maya', '--only', 'hosting', '--confirm-production', 'taskly-maya']
  assert.deepEqual(deploymentPlan(approved), ['deploy', '--config', 'firebase.json', '--project', 'taskly-maya', '--only', 'hosting'])
  for (const args of [[], approved.slice(0, 4), [...approved, '--force'], approved.map((v) => v === 'taskly-maya' ? 'staging' : v), approved.map((v) => v === 'hosting' ? 'firestore' : v)]) assert.throws(() => deploymentPlan(args), /refused/)
  assert.equal(JSON.parse(readFileSync('.firebaserc')).projects.default, undefined)
})
