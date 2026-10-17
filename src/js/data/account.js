import { SCHEMA_VERSION, validDateKey, validId } from '../firestore/schema.js'

const ordered = (records) => records.map(({ data }) => data)
  .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
const check = (condition, message) => { if (!condition) throw new Error(message) }

// Explicit caller-owned inputs only. This module never imports local storage,
// defaults, backups or the guest repository. It does not cache or optimistically
// publish results; successful mutations mean the server transaction committed.
export function createAccountData(repository) {
  const full = (data) => ({ ...data, schemaVersion: SCHEMA_VERSION, ownerId: repository.uid })
  const dayPath = (dateKey) => {
    check(validDateKey(dateKey), 'A stable local date key is required.')
    return `days/${dateKey}`
  }
  const taskPath = (dateKey, id) => {
    check(validId(id), 'A valid task ID is required.')
    return `${dayPath(dateKey)}/tasks/${id}`
  }
  async function changeTask(dateKey, id, transform, { create = false } = {}) {
    const parent = dayPath(dateKey)
    const path = taskPath(dateKey, id)
    return repository.atomic([parent, path], (before) => {
      check(create ? before[path] === null : before[path] !== null, create ? 'Task already exists.' : 'Task does not exist.')
      return [
        { path: parent, data: before[parent] ?? full({ dateKey, currentListId: null }) },
        { path, data: transform(before[path]) },
      ]
    })
  }
  async function snapshot(collection, record) {
    const { tasks, ...metadata } = structuredClone(record)
    check(validId(record.id) && Array.isArray(tasks), 'Invalid snapshot.')
    check(new Set(tasks.map((task) => task.id)).size === tasks.length, 'Duplicate snapshot task IDs.')
    const parent = `${collection}/${record.id}`
    const changes = [{ path: parent, data: full(metadata) }, ...tasks.map((task, order) => ({
      path: `${parent}/tasks/${task.id}`, data: full({ id: task.id, text: task.text, completed: task.completed, order }),
    }))]
    return repository.atomic(changes.map(({ path }) => path), (before) => {
      check(Object.values(before).every((value) => value === null), 'Snapshot already exists; replacement is disabled.')
      return changes
    })
  }
  async function loadSnapshots(collection) {
    const parents = ordered(await repository.list(collection))
    return Promise.all(parents.map(async (parent) => ({
      ...parent, tasks: ordered(await repository.list(`${collection}/${parent.id}/tasks`)),
    })))
  }
  return Object.freeze({
    uid: repository.uid,
    loadTasks: async (dateKey) => ordered(await repository.list(`${dayPath(dateKey)}/tasks`)),
    createTask: (dateKey, task, order) => changeTask(dateKey, task.id,
      () => full({ id: task.id, text: task.text, completed: task.completed, order }), { create: true }),
    editTask: (dateKey, id, text) => changeTask(dateKey, id, (task) => ({ ...task, text })),
    completeTask: (dateKey, id, completed) => changeTask(dateKey, id, (task) => ({ ...task, completed })),
    deleteTask: (dateKey, id) => changeTask(dateKey, id, () => null),
    reorderTasks(dateKey, ids) {
      check(new Set(ids).size === ids.length, 'Duplicate task IDs.')
      const parent = dayPath(dateKey)
      const paths = ids.map((id) => taskPath(dateKey, id))
      return repository.atomic([parent, ...paths], (before) => {
        check(before[parent] !== null && paths.every((path) => before[path] !== null), 'Day or task no longer exists.')
        return [{ path: parent, data: before[parent] }, ...paths.map((path, order) => ({ path, data: { ...before[path], order } }))]
      })
    },
    loadCurrentList: async (dateKey) => (await repository.read(dayPath(dateKey)))?.currentListId ?? null,
    setCurrentList(dateKey, listId) {
      const parent = dayPath(dateKey)
      check(listId === null || validId(listId), 'Invalid list reference.')
      const list = listId === null ? null : `savedLists/${listId}`
      return repository.atomic([parent, ...(list ? [list] : [])], (before) => {
        check(!list || before[list] !== null, 'Saved list does not exist.')
        return [{ path: parent, data: full({ dateKey, currentListId: listId }) }]
      })
    },
    saveList: (list) => snapshot('savedLists', list),
    loadSavedLists: () => loadSnapshots('savedLists'),
    createFinishedDay(day) {
      check(validDateKey(day.dateKey), 'Legacy timestamp-only records require an explicitly reviewed original dateKey.')
      check(Array.isArray(day.tasks) && day.totalCount === day.tasks.length
        && day.completedCount === day.tasks.filter((task) => task.completed === true).length, 'Snapshot counts do not match tasks.')
      return snapshot('finishedDays', day)
    },
    loadFinishedDays: () => loadSnapshots('finishedDays'),
    loadTheme: async () => (await repository.read('preferences/general'))?.themeId ?? null,
    saveTheme: (themeId) => repository.write('preferences/general', full({ themeId })),
    dispose: () => repository.dispose(),
  })
}
