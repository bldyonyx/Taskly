export const defaultTasks = [
  { id: crypto.randomUUID(), text: 'Choose one gentle priority', completed: true },
  { id: crypto.randomUUID(), text: 'Water the desk plant', completed: false },
  { id: crypto.randomUUID(), text: 'Send the tiny follow-up note', completed: false },
  { id: crypto.randomUUID(), text: 'Tidy the corner of the table', completed: false },
]

export function createTask(text) {
  return {
    id: crypto.randomUUID(),
    text: text.trim(),
    completed: false,
  }
}

export function completeTask(tasks, taskId, completed) {
  return tasks.map((task) => (task.id === taskId ? { ...task, completed } : task))
}

export function updateTaskText(tasks, taskId, text) {
  const nextText = text.trim()

  if (nextText.length === 0) {
    return tasks
  }

  return tasks.map((task) => (task.id === taskId ? { ...task, text: nextText } : task))
}

export function completeAllTasks(tasks) {
  return tasks.map((task) => ({ ...task, completed: true }))
}

export function uncheckAllTasks(tasks) {
  return tasks.map((task) => ({ ...task, completed: false }))
}

export function deleteAllTasks() {
  return []
}

export function removeTaskById(tasks, taskId) {
  return tasks.filter((task) => task.id !== taskId)
}

export function reorderTasksByIds(tasks, orderedTaskIds) {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const reorderedTasks = orderedTaskIds.map((taskId) => taskById.get(taskId)).filter(Boolean)

  return reorderedTasks.length === tasks.length ? reorderedTasks : tasks
}
