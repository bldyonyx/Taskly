import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { assertEmulators, PROJECT, FIRESTORE_HOST, AUTH_HOST } from '../tools/trusted/config.mjs'
import { parseCommand, planCommand, documentsFor } from '../tools/trusted/commands.mjs'

const config = { GCLOUD_PROJECT: PROJECT, FIRESTORE_EMULATOR_HOST: FIRESTORE_HOST, FIREBASE_AUTH_EMULATOR_HOST: AUTH_HOST }
test('trusted configuration fails closed for remote, missing, credentials and mixed routing', () => {
  assert.doesNotThrow(() => assertEmulators(config))
  for (const key of Object.keys(config)) {
    assert.throws(() => assertEmulators({ ...config, [key]: undefined }))
    assert.throws(() => assertEmulators({ ...config, [key]: 'taskly-maya' }))
  }
  for (const patch of [{ FIRESTORE_EMULATOR_HOST: 'localhost:8087' }, { FIREBASE_AUTH_EMULATOR_HOST: 'example.com:9100' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'file.json' }, { FIREBASE_CONFIG: '{}' }, { GOOGLE_CLOUD_PROJECT: 'remote' }]) {
    assert.throws(() => assertEmulators({ ...config, ...patch }))
  }
})
const command = { requestId: 'test', expectedRevision: 0, type: 'replaceDay',
  payload: { dateKey: '2026-10-20', tasks: [{ id: 'one', text: 'Task', completed: false }], currentListId: null } }
test('strict command grammar rejects UID injection, counts, invalid dates and duplicate tasks', () => {
  assert.deepEqual(parseCommand(command), command)
  for (const input of [{ ...command, uid: 'victim' }, { ...command, type: 'initialize' },
    { ...command, expectedRevision: -1 }, { ...command, payload: { ...command.payload, dateKey: '2026-02-30' } },
    { ...command, payload: { ...command.payload, totalCount: 1 } },
    { ...command, payload: { ...command.payload, tasks: [...command.payload.tasks, ...command.payload.tasks] } },
    { ...command, payload: { ...command.payload, tasks: [{ ...command.payload.tasks[0], ownerId: 'bob' }] } }]) {
    assert.throws(() => parseCommand(input))
  }
})
test('server derives archive provenance, counts and order; bounds reject intact input', () => {
  const state = planCommand('alice', {}, command, 'now')
  const next = planCommand('alice', state, { type: 'finishDay', payload: { dateKey: '2026-10-20', id: 'archive' } }, 'now')
  assert.equal(next['finishedDays/archive'].metadata.completedCount, 0)
  assert.equal(next['finishedDays/archive'].metadata.totalCount, 1)
  assert.equal(next['days/2026-10-20'].tasks.length, 0)
  assert.equal(state['days/2026-10-20'].tasks.length, 1)
  assert.equal(documentsFor('alice', 2, next)['lifecycle/state'].revision, 2)
  const huge = structuredClone(state)
  huge['days/2026-10-20'].tasks = Array.from({ length: 349 }, (_, order) => ({ ...state['days/2026-10-20'].tasks[0], id: `task-${order}`, order }))
  assert.throws(() => documentsFor('alice', 1, huge))
})
test('trusted process socket guard rejects remote and ambiguous destinations before connecting', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import net from 'node:net';
    import assert from 'node:assert/strict';
    import { installLoopbackGuard, blockedConnections } from './tools/trusted/network.mjs';
    installLoopbackGuard();
    for (const options of [{host:'example.com',port:443},{host:'169.254.169.254',port:80},
      {host:'127.0.0.1',port:443},{host:'localhost',port:8087}]) {
      assert.throws(() => new net.Socket().connect(options));
    }
    assert.equal(blockedConnections().length,4);
  `], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
})
