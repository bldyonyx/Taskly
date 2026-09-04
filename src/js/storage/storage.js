const STORAGE_KEY = 'taskly.tasks.v1'

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
