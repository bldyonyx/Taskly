import test from 'node:test'
import assert from 'node:assert/strict'
import { getApps } from 'firebase-admin/app'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { createSignedIdentity } from '../tools/staging/identity.mjs'
import { createHttpsAdapter } from '../tools/staging/https.mjs'
import { createStagingRuntime, assertRemoteEnvironment } from '../tools/staging/runtime.mjs'
import { stagingShape, assertStagingActivation } from '../src/staging/config.js'

const env = { TASKLY_STAGING_ENV: 'staging', TASKLY_STAGING_PROJECT_ID: 'taskly-synthetic-staging',
  TASKLY_STAGING_AUTH_DOMAIN: 'taskly-synthetic-staging.firebaseapp.com', TASKLY_STAGING_API_KEY: 'synthetic',
  TASKLY_STAGING_APP_ID: '1:456:web:abc', TASKLY_STAGING_ORIGIN: 'https://pilot.example.test',
  TASKLY_STAGING_ENDPOINT: 'https://commands.example.test/mutate', GCLOUD_PROJECT: 'taskly-synthetic-staging' }
const config = stagingShape(env), now = 1800000000000
const claims = { uid: 'alice', sub: 'alice', aud: config.projectId, iss: `https://securetoken.google.com/${config.projectId}`,
  exp: now / 1000 + 3600, iat: now / 1000 - 60, auth_time: now / 1000 - 120 }
const command = { type: 'replaceDay', requestId: 'one', expectedRevision: 0,
  payload: { dateKey: '2026-10-24', tasks: [], currentListId: null } }
const failure = code => Object.assign(new Error('sensitive account details'), { trustedCode: code })
function setup({ identity = {}, user = {}, verifyError, execute, clock = () => now } = {}) {
  const calls = [], effects = []
  const verifyIdentity = createSignedIdentity({ projectId: config.projectId, now: clock, auth: {
    async verifyIdToken(token, revoked) {
      calls.push([token, revoked])
      if (verifyError || token !== 'mock-signed-token') throw new Error('invalid signature')
      return { ...claims, ...identity }
    },
    async getUser(uid) { return { uid, disabled: false, ...user } },
  } })
  const handle = createHttpsAdapter({ config, verifyIdentity, now: clock, assertRuntime() {},
    executeVerified: async (uid, input) => {
      effects.push([uid, input])
      if (execute) return execute(uid, input)
      return { ok: true, confirmed: true, revision: 1, replayed: false }
    } })
  const request = (patch = {}) => {
    const { headers, body, url, ...rest } = patch
    return handle(new Request(url ?? config.endpoint, { method: 'POST',
      headers: { Origin: config.origin, 'Content-Type': 'application/json', Authorization: 'Bearer mock-signed-token', ...headers },
      body: body ?? JSON.stringify(command), ...rest }))
  }
  return { handle, request, calls, effects }
}

test('MOCK verifier accepts project-bound claims and requests Admin revocation checking; UID is derived', async () => {
  const { request, calls, effects } = setup()
  assert.equal((await request()).status, 200)
  assert.deepEqual(calls, [['mock-signed-token', true]])
  assert.equal(effects[0][0], 'alice')
})

test('LOCAL TEST KEY: injected RS256 verifier checks a signed JWT and rejects signature tampering', async () => {
  // Real local RSA only. This does not test Firebase certificate retrieval,
  // Google's keys, live revocation, remote credentials or Admin JWT internals.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'local-test-only' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const content = `${header}.${payload}`
  const signature = sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')
  const verifyIdentity = createSignedIdentity({ projectId: config.projectId, now: () => now, auth: {
    async verifyIdToken(token, revoked) {
      assert.equal(revoked, true)
      const [h, p, s] = token.split('.')
      if (!verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))) throw new Error('Bad signature')
      return JSON.parse(Buffer.from(p, 'base64url'))
    }, async getUser(uid) { return { uid, disabled: false } },
  } })
  assert.equal(await verifyIdentity(`${content}.${signature}`), 'alice')
  const forged = Buffer.from(JSON.stringify({ ...claims, uid: 'bob', sub: 'bob' })).toString('base64url')
  await assert.rejects(verifyIdentity(`${header}.${forged}.${signature}`), { trustedCode: 'unauthenticated' })
})

test('MOCK verifier rejects missing, invalid and unsigned tokens before mutation', async () => {
  for (const Authorization of ['', 'Bearer invalid', 'Bearer e30.e30.', 'Basic cookie']) {
    const { request, effects } = setup()
    assert.equal((await request({ headers: { Authorization, Cookie: 'session=forged' } })).status, 401)
    assert.equal(effects.length, 0)
  }
})

test('MOCK verifier rejects expired, wrong issuer/audience, invalid time/UID, disabled and revoked identity', async () => {
  for (const identity of [{ exp: now / 1000 }, { aud: 'taskly-maya' }, { iss: 'https://attacker.test' },
    { sub: 'bob' }, { uid: '../bob' }, { iat: now / 1000 + 1 }, { auth_time: undefined }]) {
    const { request, effects } = setup({ identity })
    assert.equal((await request()).status, 401); assert.equal(effects.length, 0)
  }
  for (const options of [{ user: { disabled: true } }, { user: { uid: 'bob' } }, { verifyError: true }]) {
    assert.equal((await setup(options).request()).status, 401)
  }
})

test('HTTP grammar rejects UID injection, unsupported workflows, revision and request ID errors', async () => {
  for (const patch of [{ uid: 'bob' }, { type: 'import' }, { expectedRevision: -1 }, { requestId: '../path' },
    { payload: { ...command.payload, ownerId: 'bob' } }]) {
    const { request, effects } = setup()
    assert.equal((await request({ body: JSON.stringify({ ...command, ...patch }) })).status, 400)
    assert.equal(effects.length, 0)
  }
})

test('CORS exact origin rejection and preflight allow only bearer JSON POST', async () => {
  for (const Origin of ['', 'null', 'http://pilot.example.test', 'https://evil.test']) {
    const response = await setup().request({ headers: { Origin } })
    assert.equal(response.status, 403); assert.equal(response.headers.has('Access-Control-Allow-Origin'), false)
  }
  const { handle } = setup()
  const options = headers => handle(new Request(config.endpoint, { method: 'OPTIONS', headers: { Origin: config.origin,
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type', ...headers } }))
  const response = await options({})
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), config.origin)
  assert.equal(response.headers.has('Access-Control-Allow-Credentials'), false)
  assert.equal((await options({ 'Access-Control-Request-Headers': 'Cookie' })).status, 400)
  assert.equal((await options({ 'Access-Control-Request-Method': 'DELETE' })).status, 400)
})

test('HTTP rejects methods, routes, content type, malformed JSON and oversized streamed/declared body', async () => {
  for (const patch of [{ method: 'PUT' }, { url: `${config.endpoint}?project=taskly-maya` },
    { headers: { 'Content-Type': 'text/plain' } }, { headers: { 'Content-Encoding': 'gzip' } },
    { body: '{' }, { body: 'x'.repeat(262145) }, { headers: { 'Content-Length': '262145' } }]) {
    const { request, effects } = setup()
    assert.ok([400, 413].includes((await request(patch)).status)); assert.equal(effects.length, 0)
  }
  assert.equal((await setup().handle(new Request(config.endpoint, { method: 'GET', headers: { Origin: config.origin } }))).status, 400)
})

test('authorization, expiry, conflicts and unknown server failures have sanitized structured responses', async () => {
  for (const [code, status] of [['forbidden', 403], ['conflict', 409], ['idempotency-conflict', 409],
    ['limit', 413], ['integrity', 503], ['unknown', 503]]) {
    const response = await setup({ execute() { throw failure(code) } }).request()
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { ok: false, code: code === 'unknown' ? 'unavailable' : code, confirmed: false })
  }
})

test('process rate limiter bounds attempts per UID and resets its bounded window', async () => {
  let clock = now
  const { request, effects } = setup({ clock: () => clock })
  for (let i = 0; i < 30; i++) assert.equal((await request()).status, 200)
  assert.equal((await request()).status, 429); assert.equal(effects.length, 30)
  clock += 60000
  assert.equal((await request()).status, 200)
})

test('staging config and runtime reject production/mixed routing and activation before Admin or fetch', () => {
  const before = getApps().length, original = globalThis.fetch
  let calls = 0
  globalThis.fetch = () => { calls++; throw new Error('No remote access') }
  try {
    assert.deepEqual(stagingShape(env), config)
    for (const patch of [{ TASKLY_STAGING_PROJECT_ID: 'taskly-maya' }, { TASKLY_STAGING_ENV: 'production' },
      { TASKLY_STAGING_ENDPOINT: 'http://localhost/mutate' }, { TASKLY_STAGING_APP_ID: '' },
      { TASKLY_STAGING_ORIGIN: 'https://pilot.example.test/path' }, { TASKLY_STAGING_MAX_DOCUMENTS: '51' }]) {
      assert.throws(() => stagingShape({ ...env, ...patch }))
    }
    assert.throws(() => assertStagingActivation({ ...env, VITE_CLOUD_SYNC_ENABLED: 'true', TASKLY_STAGING_ACTIVATE: 'approved-synthetic-pilot' }))
    assert.throws(() => createStagingRuntime(env))
    for (const patch of [{ FIRESTORE_EMULATOR_HOST: '127.0.0.1:8087' }, { GOOGLE_APPLICATION_CREDENTIALS: 'key.json' },
      { GCLOUD_PROJECT: 'taskly-maya' }, { GOOGLE_CLOUD_PROJECT: 'taskly-maya' }, { FIREBASE_CONFIG: '{}' }]) {
      assert.throws(() => assertRemoteEnvironment({ ...env, ...patch }))
    }
    assert.equal(calls, 0); assert.equal(getApps().length, before)
  } finally { globalThis.fetch = original }
})
