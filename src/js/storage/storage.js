const STORAGE_KEY = 'taskly.tasks.v1'
const TASKS_BY_DATE_KEY = 'taskly.tasksByDate.v1'
const CURRENT_LIST_BY_DATE_KEY = 'taskly.currentListByDate.v1'

export function normalizeTasks(tasks = []) {
  if (!Array.isArray(tasks)) {
    return []
  }

  return tasks
    .filter((task) => task && typeof task.text === 'string')
    .map((task) => ({
      id: typeof task.id === 'string' ? task.id : crypto.randomUUID(),
      text: task.text.trim(),
      completed: Boolean(task.completed),
    }))
    .filter((task) => task.text.length > 0)
}

export function loadTasks(fallbackTasks = []) {
  try {
    const storedTasks = JSON.parse(localStorage.getItem(STORAGE_KEY))

    if (!Array.isArray(storedTasks)) {
      return fallbackTasks
    }

    return normalizeTasks(storedTasks)
  } catch {
    return fallbackTasks
  }
}

export function saveTasks(tasks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

export function loadTasksByDate(todayKey, fallbackTasks = []) {
  try {
    const storedTasksByDate = JSON.parse(localStorage.getItem(TASKS_BY_DATE_KEY))

    if (storedTasksByDate && typeof storedTasksByDate === 'object' && !Array.isArray(storedTasksByDate)) {
      return normalizeTasksByDate(storedTasksByDate)
    }

    const migratedTasks = loadTasks(fallbackTasks)

    return {
      [todayKey]: migratedTasks,
    }
  } catch {
    return {
      [todayKey]: normalizeTasks(fallbackTasks),
    }
  }
}

export function saveTasksByDate(tasksByDate) {
  localStorage.setItem(TASKS_BY_DATE_KEY, JSON.stringify(normalizeTasksByDate(tasksByDate)))
}

export function loadCurrentListIdsByDate(todayKey, fallbackListId = null) {
  try {
    const storedListIdsByDate = JSON.parse(localStorage.getItem(CURRENT_LIST_BY_DATE_KEY))

    if (storedListIdsByDate && typeof storedListIdsByDate === 'object' && !Array.isArray(storedListIdsByDate)) {
      return Object.fromEntries(
        Object.entries(storedListIdsByDate).filter(([dateKey, listId]) => isDateKey(dateKey) && typeof listId === 'string'),
      )
    }
  } catch {
    // Keep the old current list tied to today's migrated tasks.
  }

  return fallbackListId ? { [todayKey]: fallbackListId } : {}
}

export function saveCurrentListIdsByDate(currentListIdsByDate) {
  localStorage.setItem(CURRENT_LIST_BY_DATE_KEY, JSON.stringify(currentListIdsByDate))
}

function normalizeTasksByDate(tasksByDate) {
  return Object.fromEntries(
    Object.entries(tasksByDate)
      .filter(([dateKey]) => isDateKey(dateKey))
      .map(([dateKey, tasks]) => [dateKey, normalizeTasks(tasks)]),
  )
}

function isDateKey(dateKey) {
  return typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
}
