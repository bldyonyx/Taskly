import { normalizeTasks } from '../storage/storage.js'

const SAVED_LISTS_KEY = 'taskly.savedLists.v1'
const CURRENT_LIST_KEY = 'taskly.currentListId.v1'

export function loadSavedLists() {
  try {
    const lists = JSON.parse(localStorage.getItem(SAVED_LISTS_KEY))

    if (!Array.isArray(lists)) {
      return []
    }

    return lists
      .filter((list) => list && typeof list.name === 'string')
      .map((list) => ({
        id: typeof list.id === 'string' ? list.id : crypto.randomUUID(),
        name: list.name.trim(),
        tasks: normalizeTasks(list.tasks),
        createdAt: typeof list.createdAt === 'string' ? list.createdAt : new Date().toISOString(),
        updatedAt: typeof list.updatedAt === 'string' ? list.updatedAt : new Date().toISOString(),
      }))
      .filter((list) => list.name.length > 0)
  } catch {
    return []
  }
}

export function saveSavedLists(lists) {
  localStorage.setItem(SAVED_LISTS_KEY, JSON.stringify(lists))
}

export function createSavedList(name, tasks) {
  const now = new Date().toISOString()

  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    tasks: createSavedTaskSnapshot(tasks),
    createdAt: now,
    updatedAt: now,
  }
}

export function updateSavedList(list, tasks, name = list.name) {
  return {
    ...list,
    name: name.trim(),
    tasks: createSavedTaskSnapshot(tasks),
    updatedAt: new Date().toISOString(),
  }
}

export function createSavedTaskSnapshot(tasks) {
  return normalizeTasks(tasks).map((task) => ({ ...task }))
}

export function createActiveTasksFromSavedList(list) {
  return createSavedTaskSnapshot(list?.tasks).map((task) => ({
    ...task,
    id: crypto.randomUUID(),
    completed: false,
  }))
}

export function loadCurrentListId() {
  const currentListId = localStorage.getItem(CURRENT_LIST_KEY)

  return typeof currentListId === 'string' && currentListId.length > 0 ? currentListId : null
}

export function saveCurrentListId(listId) {
  if (listId) {
    localStorage.setItem(CURRENT_LIST_KEY, listId)
    return
  }

  localStorage.removeItem(CURRENT_LIST_KEY)
}
