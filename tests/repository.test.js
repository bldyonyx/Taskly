import test from 'node:test'
import assert from 'node:assert/strict'
import { createLocalRepository } from '../src/js/storage/repository.js'
import { createBackup, restoreBackup, recoverPendingRestore, RECOVERY_KEY } from '../src/js/storage/backup.js'
import { applyTheme, applySavedTheme, selectTheme } from '../src/js/ui/themes.js'

class SpyStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values))
    this.writes = []
  }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.writes.push(key); this.values.set(key, value) }
  removeItem(key) { this.writes.push(key); this.values.delete(key) }
}

const today = '2026-10-17'
const tasks = [
  { id: 'second', text: 'First in display order', completed: true },
  { id: 'first', text: 'Second in display order', completed: false },
]
const lists = [{ id: 'list-1', name: 'My list', tasks, createdAt: '2026-10-01', updatedAt: '2026-10-02' }]
const days = [{ id: 'day-1', date: '2026-10-16', tasks, completedCount: 1, totalCount: 2, createdAt: '2026-10-16' }]

test('repository construction is lazy; loading empty storage never persists sample data', () => {
  let accessed = 0
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => { accessed++; return storage })
  assert.equal(accessed, 0)
  assert.deepEqual(repo.loadState(today, tasks).tasksByDate, { [today]: tasks })
  assert.deepEqual(storage.writes, [])
  assert.equal(storage.values.size, 0)
})

test('legacy task and current-list fallbacks are read in memory without migrating keys', () => {
  const storage = new SpyStorage({
    'taskly.tasks.v1': JSON.stringify(tasks),
    'taskly.currentListId.v1': 'list-1',
    'taskly.savedLists.v1': JSON.stringify(lists),
  })
  const raw = [...storage.values]
  const repo = createLocalRepository(() => storage)
  const state = repo.loadState(today)
  assert.deepEqual(state.tasksByDate, { [today]: tasks })
  assert.deepEqual(state.currentListIdsByDate, { [today]: 'list-1' })
  assert.deepEqual([...storage.values], raw)
  assert.deepEqual(storage.writes, [])
  repo.saveTasksByDate(state.tasksByDate)
  repo.saveCurrentListIdsByDate(today, state.currentListIdsByDate)
  assert.equal(storage.getItem('taskly.tasks.v1'), JSON.stringify(tasks))
  assert.deepEqual(JSON.parse(storage.getItem('taskly.tasksByDate.v1')), { [today]: tasks })
  const tomorrow = repo.loadState('2026-10-18')
  assert.deepEqual(tomorrow.currentListIdsByDate, { [today]: 'list-1' })
})

test('normalization, malformed-data fallbacks and reference pruning never rewrite stored values', () => {
  const storage = new SpyStorage({
    'taskly.tasksByDate.v1': '{broken',
    'taskly.savedLists.v1': '{broken',
    'taskly.finishedDays.v1': '{broken',
    'taskly.currentListByDate.v1': JSON.stringify({ [today]: 'missing-list' }),
  })
  const original = [...storage.values]
  const state = createLocalRepository(() => storage).loadState(today, tasks)
  assert.deepEqual(state.tasksByDate, { [today]: tasks })
  assert.deepEqual(state.savedLists, [])
  assert.deepEqual(state.finishedDays, [])
  assert.deepEqual(state.currentListIdsByDate, {})
  assert.deepEqual([...storage.values], original)
  assert.deepEqual(storage.writes, [])
})

test('explicit saves preserve formats, task ordering, completion, dates, lists and snapshots', () => {
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => storage)
  const dated = { [today]: tasks, '2026-10-18': [...tasks].reverse() }
  repo.saveTasksByDate(dated)
  repo.saveSavedLists(lists)
  repo.saveFinishedDays(days)
  repo.saveCurrentListIdsByDate(today, { [today]: 'list-1' })
  repo.saveTheme('forest')
  assert.deepEqual(repo.loadState(today), {
    tasksByDate: dated, savedLists: lists, finishedDays: days,
    currentListIdsByDate: { [today]: 'list-1' },
  })
  assert.equal(repo.loadTheme(), 'forest')
  assert.equal(storage.getItem('taskly.currentListId.v1'), 'list-1')
  assert.equal(storage.getItem('taskly.tasks.v1'), null)
})

test('unchanged saves and removing an absent legacy reference do not write', () => {
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => storage)
  const save = () => {
    repo.saveTasksByDate({ [today]: tasks })
    repo.saveSavedLists(lists)
    repo.saveFinishedDays(days)
    repo.saveCurrentListIdsByDate(today, {})
    repo.saveTheme('forest')
  }
  save()
  assert.equal(storage.writes.length, 5)
  storage.writes = []
  save()
  repo.loadState(today)
  assert.deepEqual(storage.writes, [])
})

test('list references keep the legacy key tied to today, not the selected date', () => {
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => storage)
  repo.saveCurrentListIdsByDate(today, { [today]: 'today-list', '2026-10-18': 'other-list' })
  assert.equal(storage.getItem('taskly.currentListId.v1'), 'today-list')
  repo.saveCurrentListIdsByDate(today, { '2026-10-18': 'other-list' })
  assert.equal(storage.getItem('taskly.currentListId.v1'), null)
  assert.deepEqual(JSON.parse(storage.getItem('taskly.currentListByDate.v1')), { '2026-10-18': 'other-list' })
})

test('backup restore refreshes repository reads without a stale cache or extra writes', () => {
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => storage)
  repo.saveTasksByDate({ [today]: tasks })
  repo.saveSavedLists(lists)
  repo.saveFinishedDays(days)
  repo.saveTheme('forest')
  const original = createBackup(storage)
  repo.saveTasksByDate({ [today]: [] })
  repo.saveTheme('rose')
  restoreBackup(original, storage)
  storage.writes = []
  assert.deepEqual(repo.loadState(today).tasksByDate[today], tasks)
  assert.deepEqual(repo.loadState(today).savedLists, lists)
  assert.deepEqual(repo.loadState(today).finishedDays, days)
  assert.equal(repo.loadTheme(), 'forest')
  assert.deepEqual(storage.writes, [])
})

test('pending recovery still restores data before repository hydration', () => {
  const storage = new SpyStorage({ 'taskly.tasksByDate.v1': JSON.stringify({ [today]: tasks }) })
  const backup = createBackup(storage)
  storage.setItem(RECOVERY_KEY, JSON.stringify({ status: 'pending', backup }))
  storage.setItem('taskly.tasksByDate.v1', '{}')
  recoverPendingRestore(storage)
  storage.writes = []
  assert.deepEqual(createLocalRepository(() => storage).loadState(today).tasksByDate[today], tasks)
  assert.deepEqual(storage.writes, [])
})

test('repository propagates mutation write failures instead of caching unsaved data', () => {
  const storage = new SpyStorage()
  const repo = createLocalRepository(() => storage)
  const setItem = storage.setItem.bind(storage)
  storage.setItem = () => { throw new Error('Quota exceeded') }
  assert.throws(() => repo.saveTasksByDate({ [today]: tasks }), /Quota exceeded/)
  storage.setItem = setItem
  repo.saveTasksByDate({ [today]: tasks })
  assert.equal(storage.writes.length, 1)
})

test('applying saved or remote themes is render-only; user selection persists explicitly', () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const storage = new SpyStorage({ 'taskly.theme.v1': 'forest' })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { dataset: {} } } })
  try {
    applySavedTheme()
    assert.equal(document.documentElement.dataset.theme, 'forest')
    applyTheme('ocean')
    assert.equal(document.documentElement.dataset.theme, 'ocean')
    assert.deepEqual(storage.writes, [])
    selectTheme('rose')
    assert.equal(storage.getItem('taskly.theme.v1'), 'rose')
    assert.deepEqual(storage.writes, ['taskly.theme.v1'])
    selectTheme('rose')
    assert.equal(storage.writes.length, 1)
    storage.setItem('taskly.theme.v1', 'unrecognized')
    storage.writes = []
    applySavedTheme()
    assert.equal(document.documentElement.dataset.theme, 'plum')
    assert.equal(storage.getItem('taskly.theme.v1'), 'unrecognized')
    assert.deepEqual(storage.writes, [])
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage)
    else delete globalThis.localStorage
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
  }
})
