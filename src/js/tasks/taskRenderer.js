import { animateTaskDelete } from '../animations/animations.js'

export function renderTasks(tasks, elements, handlers, icons) {
  elements.list.replaceChildren(...tasks.map((task) => createTaskElement(task, handlers, icons)))
  elements.empty.hidden = tasks.length > 0
}

function createTaskElement(task, handlers, icons) {
  const item = document.createElement('li')
  item.className = `task-item${task.completed ? ' is-done' : ''}`
  item.dataset.taskId = task.id
  item.tabIndex = 0
  item.setAttribute('role', 'button')
  item.setAttribute('aria-pressed', String(task.completed))

  const check = document.createElement('span')
  check.className = 'check-indicator'
  check.setAttribute('aria-hidden', 'true')
  check.append(icons.getTaskStateIcon(task.completed))

  const text = document.createElement('span')
  text.className = 'task-text'
  text.textContent = task.text

  const removeButton = document.createElement('button')
  removeButton.className = 'remove-task'
  removeButton.type = 'button'
  removeButton.setAttribute('aria-label', `Remove ${task.text}`)
  removeButton.append(icons.getTrashIcon())

  item.append(check, text, removeButton)

  item.addEventListener('click', () => {
    if (handlers.canToggle?.() === false) {
      return
    }

    handlers.onToggle(task.id)
  })
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()

      if (handlers.canToggle?.() === false) {
        return
      }

      handlers.onToggle(task.id)
    }
  })

  removeButton.addEventListener('click', (event) => {
    event.stopPropagation()
    animateTaskDelete(item, () => handlers.onRemove(task.id))
  })
  removeButton.addEventListener('keydown', (event) => event.stopPropagation())

  return item
}
