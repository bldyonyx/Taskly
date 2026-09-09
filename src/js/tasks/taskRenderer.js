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
  text.addEventListener('click', (event) => {
    event.stopPropagation()
  })

  const actions = document.createElement('span')
  actions.className = 'task-actions'

  const editButton = document.createElement('button')
  editButton.className = 'edit-task'
  editButton.type = 'button'
  editButton.setAttribute('aria-label', 'Edit task')
  editButton.append(icons.getEditIcon())

  const removeButton = document.createElement('button')
  removeButton.className = 'remove-task'
  removeButton.type = 'button'
  removeButton.setAttribute('aria-label', `Remove ${task.text}`)
  removeButton.append(icons.getTrashIcon())

  actions.append(editButton, removeButton)
  item.append(check, text, actions)

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

  editButton.addEventListener('click', (event) => {
    event.stopPropagation()
    startTaskEdit(item, text, task, handlers)
  })
  editButton.addEventListener('keydown', (event) => event.stopPropagation())

  removeButton.addEventListener('click', (event) => {
    event.stopPropagation()
    animateTaskDelete(item, () => handlers.onRemove(task.id))
  })
  removeButton.addEventListener('keydown', (event) => event.stopPropagation())

  return item
}

function startTaskEdit(item, text, task, handlers) {
  if (text.querySelector('.task-edit-input')) {
    return
  }

  const originalText = task.text
  let isFinished = false

  const input = document.createElement('input')
  input.className = 'task-edit-input'
  input.type = 'text'
  input.value = originalText
  input.setAttribute('aria-label', `Edit ${originalText}`)

  function restoreText() {
    item.classList.remove('is-editing', 'has-edit-error')
    text.textContent = originalText
  }

  function saveText() {
    if (isFinished) {
      return true
    }

    const nextText = input.value.trim()

    if (nextText.length === 0) {
      item.classList.add('has-edit-error')
      window.setTimeout(() => input.focus(), 0)
      return false
    }

    if (nextText === originalText) {
      isFinished = true
      item.classList.remove('has-edit-error')
      restoreText()
      return true
    }

    if (handlers.onEdit?.(task.id, nextText) === false) {
      window.setTimeout(() => input.focus(), 0)
      return false
    }

    isFinished = true
    item.classList.remove('has-edit-error')
    return true
  }

  item.classList.add('is-editing')
  text.replaceChildren(input)

  input.addEventListener('click', (event) => event.stopPropagation())
  input.addEventListener('pointerdown', (event) => event.stopPropagation())
  input.addEventListener('keydown', (event) => {
    event.stopPropagation()

    if (event.key === 'Enter') {
      event.preventDefault()
      saveText()
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      isFinished = true
      restoreText()
    }
  })
  input.addEventListener('blur', saveText)

  window.requestAnimationFrame(() => {
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  })
}
