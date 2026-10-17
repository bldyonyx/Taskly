import { validDateKey, validId } from '../firestore/schema.js'
import { createLifecycle, requireLifecycle as check } from './lifecycle.js'

// Dormant, UID-bound operations. No guest repository, localStorage or UI imports.
export function createAccountData(repository) {
  const lifecycle = createLifecycle(repository)
  const full = lifecycle.full
  const parentPath = (collection, id) => {
    check(validId(id) && (collection !== 'days' || validDateKey(id)), 'invalid-input', 'A valid ID and stable local date key are required.')
    return `${collection}/${id}`
  }
  const requireRevision = (revision) => check(Number.isSafeInteger(revision) && revision >= 0,
    'conflict', 'An expected account revision from the displayed view is required.')
  const read = () => lifecycle.transact()
  const taskPaths = (parent, tasks) => tasks.map((task) => `${parent}/tasks/${task.id}`)
  async function changeTask(dateKey, id, transform, { create = false, order } = {}) {
    const parent = parentPath('days', dateKey)
    check(validId(id), 'invalid-input', 'A valid task ID is required.')
    return lifecycle.transact({ extraPaths: [parent, `${parent}/tasks/${id}`], mutate(aggregates) {
      const day = aggregates[parent] ?? { metadata: full({ dateKey, currentListId: null }), tasks: [] }
      const index = day.tasks.findIndex((task) => task.id === id)
      check(create ? index < 0 : index >= 0, 'conflict', create ? 'Task already exists.' : 'Task does not exist.')
      if (create) {
        check(Number.isInteger(order) && order >= 0 && order <= day.tasks.length, 'invalid-input', 'Invalid insertion position.')
        day.tasks.splice(order, 0, transform(null))
      } else {
        const next = transform(day.tasks[index])
        if (next === null) day.tasks.splice(index, 1)
        else day.tasks[index] = next
      }
      aggregates[parent] = day
    } })
  }
  function snapshotInput(collection, input) {
    const { tasks, revision: ignoredRevision, ...metadata } = structuredClone(input)
    const parent = parentPath(collection, metadata.id)
    check(Array.isArray(tasks) && tasks.every((task) => validId(task.id))
      && new Set(tasks.map((task) => task.id)).size === tasks.length, 'invalid-input', 'Invalid or duplicate snapshot task IDs.')
    if (collection === 'finishedDays') {
      check(validDateKey(metadata.dateKey), 'ambiguous-date', 'Legacy timestamp-only records require an explicitly reviewed original dateKey.')
      check(!validDateKey(metadata.date) || metadata.date === metadata.dateKey, 'ambiguous-date', 'Conflicting finished-day dates.')
    }
    return { parent, metadata: full(metadata), tasks }
  }
  function saveSnapshot(collection, input) {
    const { parent, metadata, tasks } = snapshotInput(collection, input)
    return lifecycle.transact({ extraPaths: [parent, ...taskPaths(parent, tasks)], mutate(aggregates) {
      check(!aggregates[parent], 'conflict', 'Snapshot already exists; use explicit replacement with a revision.')
      aggregates[parent] = { metadata, tasks }
    } })
  }
  async function deleteParent(collection, id, expectedRevision) {
    requireRevision(expectedRevision)
    const parent = parentPath(collection, id)
    return lifecycle.transact({ expectedRevision, mutate(aggregates) {
      check(aggregates[parent], 'conflict', 'Parent no longer exists; reload to confirm deletion.')
      delete aggregates[parent]
      if (collection === 'savedLists') {
        for (const [path, day] of Object.entries(aggregates)) {
          if (path.startsWith('days/') && day.metadata.currentListId === id) day.metadata.currentListId = null
        }
      }
    } })
  }
  async function loadSnapshots(collection) {
    const { revision, aggregates } = await read()
    return Object.entries(aggregates).filter(([parent]) => parent.startsWith(`${collection}/`))
      .map(([, { metadata, tasks }]) => ({ ...metadata, tasks, revision }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }
  return Object.freeze({
    uid: repository.uid,
    initializeEmptyAccount: lifecycle.initializeEmptyAccount,
    loadAccount: read,
    loadTasks: async (dateKey) => (await read()).aggregates[parentPath('days', dateKey)]?.tasks ?? [],
    createTask: (dateKey, task, order) => {
      const copy = structuredClone(task)
      return changeTask(dateKey, copy.id, () => full(copy), { create: true, order })
    },
    editTask: (dateKey, id, text) => changeTask(dateKey, id, (task) => ({ ...task, text })),
    completeTask: (dateKey, id, completed) => changeTask(dateKey, id, (task) => ({ ...task, completed })),
    deleteTask: (dateKey, id) => changeTask(dateKey, id, () => null),
    reorderTasks(dateKey, ids, expectedRevision) {
      requireRevision(expectedRevision)
      const parent = parentPath('days', dateKey)
      const copy = [...ids]
      return lifecycle.transact({ expectedRevision, mutate(aggregates) {
        const day = aggregates[parent]
        check(day && copy.length === day.tasks.length && new Set(copy).size === copy.length
          && copy.every((id) => day.tasks.some((task) => task.id === id)), 'conflict', 'Reorder must include the complete current task membership.')
        day.tasks = copy.map((id) => day.tasks.find((task) => task.id === id))
      } })
    },
    loadCurrentList: async (dateKey) => (await read()).aggregates[parentPath('days', dateKey)]?.metadata.currentListId ?? null,
    setCurrentList(dateKey, listId) {
      const parent = parentPath('days', dateKey)
      check(listId === null || validId(listId), 'invalid-input', 'Invalid list reference.')
      return lifecycle.transact({ extraPaths: [parent], mutate(aggregates) {
        check(listId === null || aggregates[`savedLists/${listId}`], 'conflict', 'Saved list does not exist.')
        const day = aggregates[parent] ?? { metadata: full({ dateKey, currentListId: null }), tasks: [] }
        day.metadata.currentListId = listId
        aggregates[parent] = day
      } })
    },
    saveList: (list) => saveSnapshot('savedLists', list),
    replaceSavedList(list, expectedRevision) {
      requireRevision(expectedRevision)
      const { parent, metadata, tasks } = snapshotInput('savedLists', list)
      return lifecycle.transact({ expectedRevision, extraPaths: [parent, ...taskPaths(parent, tasks)], mutate(aggregates) {
        check(aggregates[parent], 'conflict', 'Saved list no longer exists.')
        aggregates[parent] = { metadata, tasks }
      } })
    },
    loadSavedLists: () => loadSnapshots('savedLists'),
    createFinishedDay: (day) => saveSnapshot('finishedDays', day),
    loadFinishedDays: () => loadSnapshots('finishedDays'),
    deleteSavedList: (id, revision) => deleteParent('savedLists', id, revision),
    deleteFinishedDay: (id, revision) => deleteParent('finishedDays', id, revision),
    deleteDay: (dateKey, revision) => deleteParent('days', dateKey, revision),
    finishDay(dateKey, input, expectedRevision) {
      requireRevision(expectedRevision)
      const parent = parentPath('days', dateKey)
      const metadata = structuredClone(input)
      check(Object.keys(metadata).length === 3 && ['id', 'createdAt', 'order'].every((key) => Object.hasOwn(metadata, key)),
        'invalid-input', 'Finish Day accepts only id, createdAt and order; its date and tasks come from the selected day.')
      const target = parentPath('finishedDays', metadata.id)
      return (async () => {
        const view = await read()
        check(view.revision === expectedRevision, 'conflict', 'Account changed; reload before finishing.')
        const source = view.aggregates[parent]
        check(source && source.tasks.length > 0, 'conflict', 'No active tasks to finish.')
        return lifecycle.transact({ expectedRevision, extraPaths: [target, ...taskPaths(target, source.tasks)], mutate(aggregates) {
          check(!aggregates[target], 'conflict', 'Finished-day ID already exists; reload to confirm the previous result.')
          const day = aggregates[parent]
          aggregates[target] = { metadata: full({ ...metadata, dateKey, date: dateKey,
            completedCount: day.tasks.filter((task) => task.completed).length, totalCount: day.tasks.length }), tasks: day.tasks }
          day.tasks = []
          day.metadata.currentListId = null
        } })
      })()
    },
    loadTheme: async () => (await repository.read('preferences/general'))?.themeId ?? null,
    saveTheme: (themeId) => repository.write('preferences/general', full({ themeId })),
    dispose: () => repository.dispose(),
  })
}
