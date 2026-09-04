import { animateProgressUpdate } from '../animations/animations.js'

export function getProgress(tasks) {
  const total = tasks.length
  const completed = tasks.filter((task) => task.completed).length
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100)

  return {
    total,
    completed,
    percentage,
  }
}

export function renderProgress(tasks, elements) {
  const progress = getProgress(tasks)

  animateProgressUpdate(elements, progress)
  elements.track.setAttribute('aria-valuemax', String(progress.total))
  elements.track.setAttribute('aria-valuenow', String(progress.completed))
  elements.track.setAttribute(
    'aria-label',
    `${progress.completed} of ${progress.total} tasks complete`,
  )
}
