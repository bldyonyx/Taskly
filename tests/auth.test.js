import test from 'node:test'
import assert from 'node:assert/strict'
import { readFirebaseConfig } from '../src/js/auth/config.js'
import { createAuthSession, authErrorMessage } from '../src/js/auth/session.js'

const userA = { uid: 'a', email: 'a@example.test', emailVerified: false, accessToken: 'must-not-be-in-view-state' }
const userB = { uid: 'b', email: 'b@example.test', emailVerified: true }

function fixture() {
  let observer
  let errorObserver
  let unsubscribed = false
  const calls = []
  const client = {
    subscribe(onUser, onError) { observer = onUser; errorObserver = onError; return () => { unsubscribed = true } },
    async signup(email, password) { calls.push(['signup', email, password]); observer(userA) },
    async login(email, password) { calls.push(['login', email, password]); observer(userA) },
    async logout() { calls.push(['logout']); observer(null) },
    async reset(email) { calls.push(['reset', email]) },
  }
  const session = createAuthSession(async () => client)
  return { session, client, calls, emit: (user) => observer(user), fail: () => errorObserver(), isUnsubscribed: () => unsubscribed }
}

test('Web configuration requires all four values; blank or partial builds remain guest-capable', () => {
  assert.equal(readFirebaseConfig(), null)
  const env = { VITE_FIREBASE_API_KEY: 'test-only', VITE_FIREBASE_AUTH_DOMAIN: 'example.test', VITE_FIREBASE_PROJECT_ID: 'demo-test', VITE_FIREBASE_APP_ID: 'test-app' }
  assert.deepEqual(readFirebaseConfig(env), { apiKey: 'test-only', authDomain: 'example.test', projectId: 'demo-test', appId: 'test-app' })
  for (const key of Object.keys(env)) {
    assert.equal(readFirebaseConfig({ ...env, [key]: '' }), null)
    assert.equal(readFirebaseConfig({ ...env, [key]: '  ' }), null)
  }
})

test('initialization waits for the Auth observer and does not assume a signed-out state', async () => {
  const { session, calls, emit } = fixture()
  await session.start()
  assert.equal(session.getState().phase, 'loading')
  assert.equal(await session.perform('login', { email: 'a@example.test', password: 'secret' }), false)
  assert.deepEqual(calls, [])
  emit(userA)
  assert.equal(session.getState().phase, 'authenticated')
  assert.deepEqual(session.getState().user, { uid: 'a', email: 'a@example.test', emailVerified: false })
  assert.equal(JSON.stringify(session.getState()).includes('must-not-be-in-view-state'), false)
})

test('absent config, failed initialization and observer failure never block local guest use', async () => {
  for (const loader of [async () => null, async () => { throw new Error('private internals') }]) {
    const session = createAuthSession(loader)
    await session.start()
    assert.equal(session.getState().phase, 'unavailable')
    assert.equal(session.getState().user, null)
    assert.equal(JSON.stringify(session.getState()).includes('private internals'), false)
    assert.equal(await session.perform('signup'), false)
  }
  const { session, fail } = fixture()
  await session.start()
  fail()
  assert.equal(session.getState().phase, 'unavailable')
})

test('signup, logout and login follow observed session changes and trim only email', async () => {
  const { session, calls, emit } = fixture()
  await session.start()
  emit(null)
  assert.equal(await session.perform('signup', { email: ' a@example.test ', password: ' space is intentional ' }), true)
  assert.equal(session.getState().user.uid, 'a')
  assert.equal(await session.perform('login'), false)
  assert.equal(await session.perform('logout'), true)
  assert.equal(session.getState().phase, 'guest')
  assert.equal(await session.perform('login', { email: ' a@example.test ', password: 'another password' }), true)
  assert.deepEqual(calls, [['signup', 'a@example.test', ' space is intentional '], ['logout'], ['login', 'a@example.test', 'another password']])
})

test('operation success never guesses identity before the Auth observer confirms it', async () => {
  const { session, client, emit } = fixture()
  await session.start()
  emit(null)
  client.login = async () => ({ user: userA })
  await session.perform('login')
  assert.equal(session.getState().phase, 'guest')
  emit(userA)
  client.logout = async () => {}
  await session.perform('logout')
  assert.equal(session.getState().phase, 'authenticated')
  emit(null)
  assert.equal(session.getState().phase, 'guest')
})

test('pending requests expose loading state and prevent duplicate submissions', async () => {
  const { session, client, emit } = fixture()
  await session.start()
  emit(null)
  let finish
  client.login = () => new Promise((resolve) => { finish = resolve })
  const first = session.perform('login')
  assert.equal(session.getState().pending, 'login')
  assert.equal(await session.perform('signup'), false)
  finish()
  await first
  assert.equal(session.getState().pending, null)
})

test('login errors are readable and clear on subsequent requests; failed logout preserves identity', async () => {
  const { session, client, emit } = fixture()
  await session.start()
  emit(null)
  client.login = async () => { throw { code: 'auth/invalid-credential', message: 'raw internal message' } }
  assert.equal(await session.perform('login'), false)
  assert.match(session.getState().error, /Could not log in/)
  assert.equal(session.getState().pending, null)
  await session.perform('reset', { email: 'a@example.test' })
  assert.equal(session.getState().error, '')
  emit(userA)
  client.logout = async () => { throw { code: 'auth/network-request-failed' } }
  assert.equal(await session.perform('logout'), false)
  assert.equal(session.getState().user.uid, 'a')
  assert.match(session.getState().error, /connection/)
})

test('password-reset feedback does not reveal whether an email has an account', async () => {
  const { session, client, emit } = fixture()
  await session.start()
  emit(null)
  await session.perform('reset', { email: 'someone@example.test' })
  const notice = session.getState().notice
  client.reset = async () => { throw { code: 'auth/user-not-found' } }
  await session.perform('reset', { email: 'missing@example.test' })
  assert.equal(session.getState().notice, notice)
  assert.equal(session.getState().error, '')
})

test('account switching removes previous identity and ignores stale feedback', async () => {
  const { session, client, emit } = fixture()
  await session.start()
  emit(null)
  let reject
  client.reset = () => new Promise((resolve, fail) => { reject = fail })
  const reset = session.perform('reset')
  emit(userA)
  emit(userB)
  reject({ code: 'auth/network-request-failed' })
  await reset
  assert.equal(session.getState().user.uid, 'b')
  assert.equal(session.getState().error, '')
  emit(null)
  assert.equal(session.getState().user, null)
  assert.equal(session.getState().phase, 'guest')
})

test('session initialization is idempotent; disposal stops further notifications', async () => {
  const { session, emit, isUnsubscribed } = fixture()
  const snapshots = []
  const unsubscribe = session.subscribe((state) => snapshots.push(state))
  assert.equal(session.start(), session.start())
  await session.start()
  emit(null)
  unsubscribe()
  const length = snapshots.length
  emit(userA)
  assert.equal(snapshots.length, length)
  session.dispose()
  assert.equal(isUnsubscribed(), true)
  emit(userB)
  assert.equal(session.getState().user.uid, 'a')
})

test('authentication never reads, overwrites, migrates or removes local Taskly data', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Auth must not touch Taskly localStorage') } })
  try {
    const { session, emit } = fixture()
    await session.start()
    emit(null)
    await session.perform('signup', { email: 'a@example.test', password: 'test password' })
    await session.perform('logout')
    await session.perform('login', { email: 'b@example.test', password: 'test password' })
    emit(userB)
    await session.perform('logout')
    assert.equal(session.getState().phase, 'guest')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('unknown Firebase errors never expose raw messages or credentials', () => {
  assert.equal(authErrorMessage({ message: 'sensitive' }).includes('sensitive'), false)
})
