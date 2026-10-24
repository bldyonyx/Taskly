import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareStagingAccount, createStagingAccount } from '../src/staging/account.js'

const config = { projectId: 'taskly-synthetic-staging', endpoint: 'https://commands.example.test/mutate' }
function setup(send, options = {}) {
  const phases = [], bodies = []
  let active = true
  const user = { auth: { app: { options: { projectId: config.projectId } } }, getIdToken: async () => 'mock-signed-token' }
  const account = prepareStagingAccount({ config, user,
    reader: { loadAccount: async () => ({ revision: 1, aggregates: {} }), loadTheme: async () => null, dispose() {} },
    check: () => { if (!active) throw new Error('Session changed.') }, onState: phase => phases.push(phase),
    requestId: () => 'stable', send: async (url, init) => {
      assert.equal(url, config.endpoint); assert.equal(init.headers.Authorization, 'Bearer mock-signed-token')
      assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); bodies.push(init.body)
      return send ? send(init) : { json: async () => ({ ok: true, confirmed: true, revision: 1 }) }
    }, ...options })
  return { account, phases, bodies, switchAccount() { active = false; account.dispose() } }
}
test('staging UI uses HTTPS ID token, loading/saving and authoritative reload before confirmed state', async () => {
  const { account, phases } = setup()
  await account.loadAccount(); await account.deleteDay('2026-10-24', 0)
  assert.deepEqual(phases, ['loading', 'ready', 'saving', 'loading', 'ready', 'confirmed'])
  await assert.rejects(account.initializeEmptyAccount()); await assert.rejects(account.saveTheme())
  account.dispose()
})
test('staging UI conflict/error and offline/timeout retain exact retry with no early confirmation', async () => {
  for (const code of ['conflict', 'forbidden']) {
    const { account, phases } = setup(async () => ({ json: async () => ({ ok: false, confirmed: false, code }) }))
    await assert.rejects(account.deleteDay('2026-10-24', 0))
    assert.equal(phases.at(-1), code === 'conflict' ? 'conflict' : 'error'); account.dispose()
  }
  for (const timeout of [false, true]) {
    let attempt = 0
    const { account, phases, bodies } = setup(async init => {
      if (++attempt === 1) {
        if (!timeout) throw new Error('offline')
        await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }))
      }
      return { json: async () => ({ ok: true, confirmed: true, revision: 1 }) }
    }, { timeoutMs: 10 })
    await assert.rejects(account.deleteDay('2026-10-24', 0), { code: 'taskly/uncertain' })
    assert.equal(phases.at(-1), 'offline'); assert.ok(!phases.includes('confirmed'))
    await account.retryPending(); assert.equal(bodies[0], bodies[1]); assert.equal(phases.at(-1), 'confirmed')
    account.dispose()
  }
})
test('staging switching aborts and suppresses late old-account state', async () => {
  let release
  const { account, phases, switchAccount } = setup(() => new Promise(resolve => { release = resolve }))
  const pending = account.deleteDay('2026-10-24', 0)
  await new Promise(resolve => setImmediate(resolve))
  switchAccount(); release({ json: async () => ({ ok: true, confirmed: true }) })
  await assert.rejects(pending, /session|changed/i)
  assert.deepEqual(phases, ['saving'])
})
test('staging adapter refuses production and emulator Auth; public factory remains disabled', () => {
  for (const auth of [{ app: { options: { projectId: 'taskly-maya' } } },
    { app: { options: { projectId: config.projectId } }, emulatorConfig: { host: '127.0.0.1' } }]) {
    assert.throws(() => prepareStagingAccount({ config, user: { auth } }))
  }
  assert.throws(() => createStagingAccount({ env: {} }))
})
