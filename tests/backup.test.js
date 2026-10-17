import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BACKUP_KEYS, RECOVERY_KEY, createBackup, parseBackup, readRecovery,
  recoverPendingRestore, restoreBackup,
} from '../src/js/storage/backup.js'

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values))
    this.fail = () => false
  }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) {
    if (this.fail(key, value)) throw new Error('Storage unavailable')
    this.values.set(key, value)
  }
  removeItem(key) {
    if (this.fail(key, null)) throw new Error('Storage unavailable')
    this.values.delete(key)
  }
}

function fixture() {
  return new MemoryStorage(Object.fromEntries(BACKUP_KEYS.map((key, i) => [key, `raw ${i}`])))
}

test('export preserves exact strings including invalid JSON, whitespace, and absent keys', () => {
  const storage = new MemoryStorage({
    [BACKUP_KEYS[0]]: '  [ { "unknown": 3 } ]\n',
    [BACKUP_KEYS[3]]: '{broken JSON',
    [BACKUP_KEYS[6]]: '',
    unrelated: 'keep',
  })
  const before = [...storage.values]
  const backup = parseBackup(JSON.stringify(createBackup(storage)))
  for (const key of BACKUP_KEYS) assert.equal(backup.values[key], storage.getItem(key))
  assert.equal(backup.values[BACKUP_KEYS[1]], null)
  assert.equal(Object.keys(backup.values).length, 7)
  assert.deepEqual([...storage.values], before)
})

test('rejects malformed envelopes and unsupported versions without writing', () => {
  const valid = createBackup(fixture())
  const invalid = [null, [], {}, { ...valid, format: 'other' },
    { ...valid, version: 2 }, { ...valid, version: '1' },
    { ...valid, exportedAt: 'invalid' }, { ...valid, values: [] },
    { ...valid, values: { ...valid.values, [BACKUP_KEYS[0]]: [] } },
    { ...valid, values: { ...valid.values, unexpected: 'x' } },
  ]
  for (const backup of invalid) {
    const storage = fixture()
    const before = [...storage.values]
    assert.throws(() => restoreBackup(backup, storage))
    assert.deepEqual([...storage.values], before)
  }
  for (const text of ['', '{bad', 'undefined']) assert.throws(() => parseBackup(text))
})

test('missing keys are rejected; explicit null means absent and is supported', () => {
  const backup = createBackup(new MemoryStorage())
  assert.doesNotThrow(() => parseBackup(JSON.stringify(backup)))
  for (const key of BACKUP_KEYS) {
    const missing = structuredClone(backup)
    delete missing.values[key]
    assert.throws(() => parseBackup(JSON.stringify(missing)))
  }
})

test('restores all seven raw values, removes only explicitly absent keys, and keeps a recovery copy', () => {
  const storage = fixture()
  storage.setItem('unrelated', 'keep')
  const original = createBackup(storage)
  const incoming = createBackup(new MemoryStorage({ [BACKUP_KEYS[0]]: '  [ ] ', [BACKUP_KEYS[6]]: 'forest' }))
  restoreBackup(incoming, storage)
  assert.deepEqual(createBackup(storage).values, incoming.values)
  assert.deepEqual(readRecovery(storage).backup.values, original.values)
  assert.equal(readRecovery(storage).status, 'complete')
  assert.equal(storage.getItem('unrelated'), 'keep')
  restoreBackup(readRecovery(storage).backup, storage)
  assert.deepEqual(createBackup(storage).values, original.values)
})

test('failure to save recovery copy leaves all user keys unchanged', () => {
  const storage = fixture()
  const original = createBackup(storage)
  storage.fail = (key) => key === RECOVERY_KEY
  assert.throws(() => restoreBackup(createBackup(new MemoryStorage()), storage), /recovery copy/)
  assert.deepEqual(createBackup(storage).values, original.values)
})

test('a replacement write or removal failure rolls back all seven keys', () => {
  for (const value of ['replacement', null]) {
    const storage = fixture()
    const original = createBackup(storage)
    const incoming = createBackup(new MemoryStorage())
    incoming.values[BACKUP_KEYS[3]] = value
    storage.fail = (key, next) => key === BACKUP_KEYS[3] && next === value
    assert.throws(() => restoreBackup(incoming, storage), /previous Taskly data was recovered/)
    assert.deepEqual(createBackup(storage).values, original.values)
    assert.equal(readRecovery(storage).status, 'complete')
  }
})

test('failure to finalize a restore also rolls back', () => {
  const storage = fixture()
  const original = createBackup(storage)
  let failed = false
  storage.fail = (key, value) => {
    if (key === RECOVERY_KEY && JSON.parse(value).status === 'complete' && !failed) {
      failed = true
      return true
    }
    return false
  }
  assert.throws(() => restoreBackup(createBackup(new MemoryStorage()), storage), /recovered/)
  assert.deepEqual(createBackup(storage).values, original.values)
})

test('failed rollback preserves recovery journal and can be retried at startup', () => {
  const storage = fixture()
  const original = createBackup(storage)
  let writes = 0
  storage.fail = (key) => key !== RECOVERY_KEY && ++writes >= 2
  assert.throws(() => restoreBackup(createBackup(new MemoryStorage()), storage), /recovery could not finish/)
  assert.equal(readRecovery(storage).status, 'pending')
  assert.deepEqual(readRecovery(storage).backup.values, original.values)
  storage.fail = () => false
  assert.equal(recoverPendingRestore(storage), true)
  assert.deepEqual(createBackup(storage).values, original.values)
  assert.equal(recoverPendingRestore(storage), false)
})

test('startup recovers an interrupted restore before normal application loading', () => {
  const storage = fixture()
  const original = createBackup(storage)
  storage.setItem(RECOVERY_KEY, JSON.stringify({ status: 'pending', backup: original }))
  storage.setItem(BACKUP_KEYS[0], 'partially restored')
  recoverPendingRestore(storage)
  assert.deepEqual(createBackup(storage).values, original.values)
})
