import { normalizeTasks } from '../storage/storage.js'

const FINISHED_DAYS_KEY = 'taskly.finishedDays.v1'

export function loadFinishedDays() {
  try {
    const days = JSON.parse(localStorage.getItem(FINISHED_DAYS_KEY))

    if (!Array.isArray(days)) {
      return []
    }

    return days
      .filter((day) => day && typeof day.date === 'string')
      .map((day) => {
        const tasks = normalizeTasks(day.tasks)
        const completedCount = tasks.filter((task) => task.completed).length

        return {
          id: typeof day.id === 'string' ? day.id : crypto.randomUUID(),
          date: day.date,
          tasks,
          completedCount,
          totalCount: tasks.length,
          createdAt: typeof day.createdAt === 'string' ? day.createdAt : day.date,
        }
      })
      .filter((day) => day.tasks.length > 0)
  } catch {
    return []
  }
}

export function saveFinishedDays(days) {
  localStorage.setItem(FINISHED_DAYS_KEY, JSON.stringify(days))
}

export function createFinishedDay(tasks, date = new Date()) {
  const normalizedTasks = normalizeTasks(tasks)
  const completedCount = normalizedTasks.filter((task) => task.completed).length
  const createdAt = date.toISOString()

  return {
    id: crypto.randomUUID(),
    date: createdAt,
    tasks: normalizedTasks,
    completedCount,
    totalCount: normalizedTasks.length,
    createdAt,
  }
}

export function createFinishedDayTaskSnapshot(tasks) {
  return normalizeTasks(tasks).map((task) => ({ ...task }))
}

export function createActiveTasksFromFinishedDay(day) {
  return createFinishedDayTaskSnapshot(day?.tasks).map((task) => ({
    ...task,
    id: crypto.randomUUID(),
  }))
}

export function updateFinishedDay(day, tasks) {
  const normalizedTasks = createFinishedDayTaskSnapshot(tasks)

  return {
    ...day,
    tasks: normalizedTasks,
    completedCount: normalizedTasks.filter((task) => task.completed).length,
    totalCount: normalizedTasks.length,
  }
}
