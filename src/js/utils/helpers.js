export function tasksSnapshot(tasks) {
  return JSON.stringify(tasks.map(({ text, completed }) => ({ text, completed })))
}
