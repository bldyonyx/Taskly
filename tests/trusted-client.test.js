import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrustedAccount } from '../src/isolated/trusted.js'

const day = { metadata: { currentListId: 'list' }, tasks: [{ id: 'a', text: 'A', completed: true }, { id: 'b', text: 'B', completed: false }] }
const view = { revision: 4, aggregates: { 'days/2026-10-21': day } }
function setup(send) {
  const bodies = []
  let active = true
  const account = createTrustedAccount({ reader: { loadAccount: async () => view, loadTheme: async () => null, dispose() {} },
    user: { getIdToken: async () => 'emulator-token' }, check: () => { if (!active) throw new Error('session changed') },
    requestId: () => 'stable-id', send: async (url, options) => {
      assert.equal(url, '/__trusted/mutate'); assert.equal(options.headers.Authorization, 'Bearer emulator-token')
      bodies.push(options.body)
      return send ? send(options) : { json: async () => ({ ok: true, confirmed: true, revision: 5 }) }
    } })
  return { account, bodies, switchAccount: () => { active = false; account.dispose() } }
}
test('trusted browser maps tasks and reorder with stable IDs, flags, reference and displayed revision', async () => {
  const { account, bodies } = setup()
  await account.loadAccount()
  await account.reorderTasks('2026-10-21', ['b', 'a'], 4)
  const command = JSON.parse(bodies[0])
  assert.equal(command.expectedRevision, 4)
  assert.deepEqual(command.payload.tasks, [day.tasks[1], day.tasks[0]])
  assert.equal(command.payload.currentListId, 'list')
  assert.equal(Object.hasOwn(command, 'uid'), false)
  assert.throws(() => account.reorderTasks('2026-10-21', ['a', 'a'], 4))
  account.dispose()
})
test('lost acknowledgment retries identical request bytes and never refreshes the revision', async () => {
  let attempts = 0
  const { account, bodies } = setup(async () => {
    if (++attempts === 1) throw new Error('lost response')
    return { json: async () => ({ ok: true, confirmed: true, replayed: true, revision: 5 }) }
  })
  await assert.rejects(account.replaceDatedTasks('2026-10-21', day.tasks, 'list', 4), { code: 'taskly/uncertain' })
  assert.equal(account.hasPending(), true)
  assert.equal((await account.retryPending()).replayed, true)
  assert.equal(bodies[0], bodies[1]); assert.equal(account.hasPending(), false)
  account.dispose()
})
test('conflict and permission failures clear pending intent and never report confirmed success', async () => {
  for (const code of ['conflict', 'forbidden', 'unauthenticated', 'limit']) {
    const { account } = setup(async () => ({ json: async () => ({ ok: false, confirmed: false, code }) }))
    await assert.rejects(account.deleteSavedList('list', 4), { code: `taskly/${code}` })
    assert.equal(account.hasPending(), false); account.dispose()
  }
})
test('account switching aborts pending transport and rejects its late result', async () => {
  let release, signal
  const { account, switchAccount } = setup((options) => { signal = options.signal; return new Promise(resolve => { release = resolve }) })
  const result = account.deleteFinishedDay('archive', 4)
  await new Promise(resolve => setImmediate(resolve))
  switchAccount(); assert.equal(signal.aborted, true)
  release({ json: async () => ({ ok: true, confirmed: true, revision: 5 }) })
  await assert.rejects(result, /session|changed/)
  assert.equal(account.hasPending(), false)
})
test('oversized browser commands and unsupported workflows never reach the transport', async () => {
  const { account, bodies } = setup()
  assert.throws(() => account.replaceDatedTasks('2026-10-21', [{ id: 'huge', text: 'x'.repeat(262144), completed: false }], null, 4), /limit/)
  await assert.rejects(account.initializeEmptyAccount(), /Unsupported/)
  await assert.rejects(account.saveTheme('rose'), /Unsupported/)
  assert.equal(bodies.length, 0); account.dispose()
})
test('browser maps server-copy snapshots, replacement and parent deletion without supplied timestamps', async () => {
  const { account, bodies } = setup()
  await account.saveListForDate({ id: 'list', name: 'Saved', createdAt: 'forged' }, '2026-10-21', 4)
  await account.replaceSavedList({ id: 'list', name: 'Replaced', tasks: day.tasks }, 4)
  await account.finishDay('2026-10-21', { id: 'archive', createdAt: 'forged' }, 4)
  await account.deleteDay('2026-10-21', 4)
  const commands = bodies.map(JSON.parse)
  assert.deepEqual(commands[0].payload, { dateKey: '2026-10-21', id: 'list', name: 'Saved' })
  assert.equal(commands[1].payload.replace, true)
  assert.deepEqual(commands[2].payload, { dateKey: '2026-10-21', id: 'archive' })
  assert.deepEqual(commands[3].payload, { collection: 'days', id: '2026-10-21' })
  account.dispose()
})
