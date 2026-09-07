import {
  CalendarDays,
  ChevronLeft,
  Circle,
  CircleCheck,
  FolderOpen,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide'
import { animateModalClose, animateModalOpen } from '../animations/animations.js'
import { makeIcon } from './icons.js'
import { applyTheme, loadThemeId, themes } from './themes.js'

export function renderCurrentListLabel(element, currentList, hasUnsavedChanges) {
  if (!currentList) {
    element.textContent = 'Not saved yet'
    element.classList.remove('is-dirty')
    return
  }

  element.textContent = `${currentList.name}${hasUnsavedChanges ? ' *' : ''}`
  element.classList.toggle('is-dirty', hasUnsavedChanges)
}

export function openSaveListDialog({ currentList, onSaveNew, onUpdateCurrent }) {
  const modal = createModal('Save list')
  const form = document.createElement('form')
  form.className = 'taskly-dialog-form'

  const label = document.createElement('label')
  label.setAttribute('for', 'saved-list-name')
  label.textContent = 'List name'

  const input = document.createElement('input')
  input.id = 'saved-list-name'
  input.name = 'saved-list-name'
  input.type = 'text'
  input.required = true
  input.maxLength = 48
  input.autocomplete = 'off'
  input.placeholder = 'Tiny errands, cozy reset...'
  input.value = currentList?.name ?? ''

  const error = document.createElement('p')
  error.className = 'dialog-error'
  error.setAttribute('role', 'alert')
  error.hidden = true

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const saveNewButton = createDialogButton('Save new', Save)
  saveNewButton.type = 'submit'

  actions.append(saveNewButton)

  if (currentList) {
    const updateButton = createDialogButton('Update current', Save)
    updateButton.type = 'button'
    updateButton.addEventListener('click', () => {
      const name = input.value.trim()

      if (!name) {
        showDialogError(error, 'Please name this list first.')
        input.focus()
        return
      }

      onUpdateCurrent(name)
      modal.close()
    })
    actions.append(updateButton)
  }

  form.append(label, input, error, actions)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = input.value.trim()

    if (!name) {
      showDialogError(error, 'Please name this list first.')
      input.focus()
      return
    }

    onSaveNew(name)
    modal.close()
  })

  modal.content.append(form)
  modal.show()
  input.focus()
}

export function openSavedListsDialog({
  lists,
  finishedDays = [],
  currentListId,
  hasCurrentTasks = false,
  onLoad,
  onDelete,
  onEdit,
  onDeleteFinishedDay,
  onLoadFinishedDay,
  onEditFinishedDay,
}) {
  const modal = createModal('Lists')
  const wrapper = document.createElement('div')
  wrapper.className = 'saved-lists-panel'

  const tabs = document.createElement('div')
  tabs.className = 'lists-tabs'
  tabs.setAttribute('role', 'tablist')

  const savedListsTab = createTabButton('Saved lists', true)
  const finishedDaysTab = createTabButton('Finished days', false)

  tabs.append(savedListsTab, finishedDaysTab)
  wrapper.append(tabs)

  const content = document.createElement('div')
  content.className = 'lists-tab-content'
  wrapper.append(content)

  function createSavedListsDescription() {
    const description = document.createElement('p')
    description.className = 'saved-lists-description'
    description.textContent = 'Save your go-to task lists as templates and load them anytime.'

    return description
  }

  function createFinishedDaysDescription() {
    const description = document.createElement('p')
    description.className = 'saved-lists-description'
    description.textContent = 'Look back at previous days or load one to pick up where you left off.'

    return description
  }

  function showSavedLists() {
    savedListsTab.classList.add('is-active')
    savedListsTab.setAttribute('aria-selected', 'true')
    finishedDaysTab.classList.remove('is-active')
    finishedDaysTab.setAttribute('aria-selected', 'false')
    content.replaceChildren()
    content.append(createSavedListsDescription())

    if (lists.length === 0) {
      content.append(createEmptyMessage('No saved lists yet.'))
      return
    }

    lists.forEach((list) => {
      const row = document.createElement('div')
      row.className = `saved-list-row${list.id === currentListId ? ' is-current' : ''}`

      const title = document.createElement('span')
      title.className = 'saved-list-title'
      title.textContent = list.name

      const editButton = createIconButton(Pencil, `Edit ${list.name}`)
      editButton.addEventListener('click', (event) => {
        event.stopPropagation()
        showSavedListEditor(list)
      })

      const loadButton = createDialogButton('Load list', FolderOpen)
      loadButton.classList.add('saved-list-load')
      loadButton.type = 'button'
      loadButton.addEventListener('click', (event) => {
        event.stopPropagation()
        requestLoadSavedList(list)
      })

      const deleteButton = createIconButton(Trash2, `Delete ${list.name}`)
      deleteButton.classList.add('is-danger')
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation()
        onDelete(list.id)
        const index = lists.findIndex((savedList) => savedList.id === list.id)

        if (index !== -1) {
          lists.splice(index, 1)
        }

        row.remove()

        const savedRows = content.querySelectorAll('.saved-list-row')

        if (savedRows.length === 0) {
          content.replaceChildren(createSavedListsDescription(), createEmptyMessage('No saved lists yet.'))
        }
      })

      row.append(title, editButton, loadButton, deleteButton)
      content.append(row)
    })
  }

  function requestLoadSavedList(list) {
    if (!hasCurrentTasks) {
      onLoad(list.id, 'replace')
      modal.close()
      return
    }

    modal.setTitle('Load this list?')
    content.replaceChildren()

    const confirmation = document.createElement('div')
    confirmation.className = 'delete-all-confirmation'

    const copy = document.createElement('p')
    copy.className = 'dialog-copy'
    copy.textContent = 'You already have tasks in your current list.'

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelButton = createDialogButton('Cancel', X)
    cancelButton.classList.add('is-secondary')
    cancelButton.type = 'button'
    cancelButton.addEventListener('click', () => {
      modal.setTitle('Lists')
      showSavedLists()
    })

    const replaceButton = createDialogButton('Replace current tasks', FolderOpen)
    replaceButton.type = 'button'
    replaceButton.addEventListener('click', () => {
      onLoad(list.id, 'replace')
      modal.close()
    })

    const addButton = createDialogButton('Add to current tasks', Plus)
    addButton.type = 'button'
    addButton.addEventListener('click', () => {
      onLoad(list.id, 'append')
      modal.close()
    })

    actions.append(cancelButton, replaceButton, addButton)
    confirmation.append(copy, actions)
    content.append(confirmation)
    cancelButton.focus()
  }

  function showSavedListEditor(list) {
    modal.setTitle('Edit saved list')
    content.replaceChildren()

    const form = document.createElement('form')
    form.className = 'taskly-dialog-form saved-list-editor'

    const nameLabel = document.createElement('label')
    nameLabel.setAttribute('for', 'edit-saved-list-name')
    nameLabel.textContent = 'List name'

    const nameInput = document.createElement('input')
    nameInput.id = 'edit-saved-list-name'
    nameInput.name = 'edit-saved-list-name'
    nameInput.type = 'text'
    nameInput.required = true
    nameInput.maxLength = 48
    nameInput.autocomplete = 'off'
    nameInput.value = list.name

    const tasksLabel = document.createElement('span')
    tasksLabel.className = 'saved-list-editor-label'
    tasksLabel.textContent = 'Tasks'

    const taskRows = document.createElement('div')
    taskRows.className = 'saved-list-editor-tasks'

    const error = document.createElement('p')
    error.className = 'dialog-error'
    error.setAttribute('role', 'alert')
    error.hidden = true

    const addButton = createDialogButton('Add task', Plus)
    addButton.classList.add('is-secondary')
    addButton.type = 'button'
    addButton.addEventListener('click', () => {
      taskRows.append(createSavedListTaskEditRow({ text: '', completed: false }))
      taskRows.lastElementChild?.querySelector('input')?.focus()
    })

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelButton = createDialogButton('Cancel', X)
    cancelButton.classList.add('is-secondary')
    cancelButton.type = 'button'
    cancelButton.addEventListener('click', () => {
      modal.setTitle('Lists')
      showSavedLists()
    })

    const saveButton = createDialogButton('Save changes', Save)
    saveButton.type = 'submit'

    list.tasks.forEach((task) => {
      taskRows.append(createSavedListTaskEditRow(task))
    })

    actions.append(cancelButton, saveButton)
    form.append(nameLabel, nameInput, tasksLabel, taskRows, addButton, error, actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()

      const name = nameInput.value.trim()
      const editedTasks = [...taskRows.querySelectorAll('.saved-list-editor-task input')]
        .map((input) => ({
          id: input.dataset.taskId || crypto.randomUUID(),
          text: input.value.trim(),
          completed: input.dataset.completed === 'true',
        }))
        .filter((task) => task.text.length > 0)

      if (!name) {
        showDialogError(error, 'Please name this list first.')
        nameInput.focus()
        return
      }

      if (editedTasks.length === 0) {
        showDialogError(error, 'Please keep at least one task in this saved list.')
        return
      }

      onEdit(list.id, editedTasks, name)
      list.name = name
      list.tasks = editedTasks
      modal.setTitle('Lists')
      showSavedLists()
    })

    content.append(form)
    nameInput.focus()
  }

  function createSavedListTaskEditRow(task) {
    const row = document.createElement('div')
    row.className = 'saved-list-editor-task'

    const input = document.createElement('input')
    input.type = 'text'
    input.required = true
    input.maxLength = 120
    input.autocomplete = 'off'
    input.value = task.text
    input.dataset.taskId = task.id ?? ''
    input.dataset.completed = String(Boolean(task.completed))

    const deleteButton = createIconButton(Trash2, `Delete ${task.text || 'task'}`)
    deleteButton.classList.add('is-danger')
    deleteButton.addEventListener('click', () => row.remove())

    row.append(input, deleteButton)

    return row
  }

  function showFinishedDays() {
    finishedDaysTab.classList.add('is-active')
    finishedDaysTab.setAttribute('aria-selected', 'true')
    savedListsTab.classList.remove('is-active')
    savedListsTab.setAttribute('aria-selected', 'false')
    content.replaceChildren()
    content.append(createFinishedDaysDescription())

    const sortedDays = [...finishedDays].sort((first, second) => {
      return new Date(second.date).getTime() - new Date(first.date).getTime()
    })

    if (sortedDays.length === 0) {
      content.append(createEmptyMessage('No finished days yet.'))
      return
    }

    sortedDays.forEach((day) => {
      content.append(createFinishedDayRow(day, {
        onOpen: () => showFinishedDayDetails(day),
        onDelete: () => showDeleteFinishedDayConfirmation(day),
      }))
    })
  }

  function showFinishedDayDetails(day) {
    modal.setTitle('Lists')
    content.replaceChildren()

    const backButton = document.createElement('button')
    backButton.type = 'button'
    backButton.className = 'finished-day-back'
    backButton.append(makeIcon(ChevronLeft), document.createTextNode('Finished days'))
    backButton.addEventListener('click', showFinishedDays)

    const details = document.createElement('div')
    details.className = 'finished-day-details'

    const title = document.createElement('h3')
    title.textContent = formatFinishedDayDate(day.date)

    const progress = document.createElement('p')
    progress.className = 'finished-day-progress-text'
    progress.textContent = `${day.completedCount} / ${day.totalCount} completed`

    const taskList = document.createElement('ul')
    taskList.className = 'finished-day-task-list'

    day.tasks.forEach((task) => {
      const item = document.createElement('li')
      item.className = `finished-day-task${task.completed ? ' is-done' : ''}`

      const marker = document.createElement('span')
      marker.className = 'finished-day-task-marker'
      marker.setAttribute('aria-hidden', 'true')
      marker.append(makeIcon(task.completed ? CircleCheck : Circle))

      const text = document.createElement('span')
      text.textContent = task.text

      item.append(marker, text)
      taskList.append(item)
    })

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const editButton = createDialogButton('Edit', Pencil)
    editButton.type = 'button'
    editButton.addEventListener('click', () => showFinishedDayEditor(day))

    const loadButton = createDialogButton('Load list', FolderOpen)
    loadButton.type = 'button'
    loadButton.addEventListener('click', () => requestLoadFinishedDay(day))

    const deleteButton = createDialogButton('Delete', Trash2)
    deleteButton.classList.add('is-danger')
    deleteButton.type = 'button'
    deleteButton.addEventListener('click', () => showDeleteFinishedDayConfirmation(day, () => {
      modal.setTitle('Lists')
      showFinishedDayDetails(day)
    }))

    actions.append(editButton, loadButton, deleteButton)
    details.append(title, progress, taskList, actions)
    content.append(backButton, details)
  }

  function requestLoadFinishedDay(day) {
    if (!hasCurrentTasks) {
      onLoadFinishedDay(day.id, 'replace')
      modal.close()
      return
    }

    modal.setTitle('Load this finished day?')
    content.replaceChildren()

    const confirmation = document.createElement('div')
    confirmation.className = 'delete-all-confirmation'

    const copy = document.createElement('p')
    copy.className = 'dialog-copy'
    copy.textContent = 'You already have tasks in your current list.'

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelButton = createDialogButton('Cancel', X)
    cancelButton.classList.add('is-secondary')
    cancelButton.type = 'button'
    cancelButton.addEventListener('click', () => showFinishedDayDetails(day))

    const replaceButton = createDialogButton('Replace current tasks', FolderOpen)
    replaceButton.type = 'button'
    replaceButton.addEventListener('click', () => {
      onLoadFinishedDay(day.id, 'replace')
      modal.close()
    })

    const addButton = createDialogButton('Add to current tasks', Plus)
    addButton.type = 'button'
    addButton.addEventListener('click', () => {
      onLoadFinishedDay(day.id, 'append')
      modal.close()
    })

    actions.append(cancelButton, replaceButton, addButton)
    confirmation.append(copy, actions)
    content.append(confirmation)
    cancelButton.focus()
  }

  function showFinishedDayEditor(day) {
    modal.setTitle('Edit finished day')
    content.replaceChildren()

    const form = document.createElement('form')
    form.className = 'taskly-dialog-form saved-list-editor'

    const tasksLabel = document.createElement('span')
    tasksLabel.className = 'saved-list-editor-label'
    tasksLabel.textContent = 'Tasks'

    const taskRows = document.createElement('div')
    taskRows.className = 'saved-list-editor-tasks'

    const error = document.createElement('p')
    error.className = 'dialog-error'
    error.setAttribute('role', 'alert')
    error.hidden = true

    const addButton = createDialogButton('Add task', Plus)
    addButton.classList.add('is-secondary')
    addButton.type = 'button'
    addButton.addEventListener('click', () => {
      taskRows.append(createFinishedDayTaskEditRow({ text: '', completed: false }))
      taskRows.lastElementChild?.querySelector('input')?.focus()
    })

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelButton = createDialogButton('Cancel', X)
    cancelButton.classList.add('is-secondary')
    cancelButton.type = 'button'
    cancelButton.addEventListener('click', () => showFinishedDayDetails(day))

    const saveButton = createDialogButton('Save changes', Save)
    saveButton.type = 'submit'

    day.tasks.forEach((task) => {
      taskRows.append(createFinishedDayTaskEditRow(task))
    })

    actions.append(cancelButton, saveButton)
    form.append(tasksLabel, taskRows, addButton, error, actions)
    form.addEventListener('submit', (event) => {
      event.preventDefault()

      const editedTasks = [...taskRows.querySelectorAll('.saved-list-editor-task')]
        .map((row) => {
          const input = row.querySelector('input')

          return {
            id: input.dataset.taskId || crypto.randomUUID(),
            text: input.value.trim(),
            completed: row.dataset.completed === 'true',
          }
        })
        .filter((task) => task.text.length > 0)

      if (editedTasks.length === 0) {
        showDialogError(error, 'Please keep at least one task in this finished day.')
        return
      }

      const completedCount = editedTasks.filter((task) => task.completed).length
      onEditFinishedDay(day.id, editedTasks)
      day.tasks = editedTasks
      day.completedCount = completedCount
      day.totalCount = editedTasks.length
      modal.setTitle('Lists')
      showFinishedDayDetails(day)
    })

    content.append(form)
    taskRows.querySelector('input')?.focus()
  }

  function createFinishedDayTaskEditRow(task) {
    const row = document.createElement('div')
    row.className = 'saved-list-editor-task finished-day-editor-task'
    row.dataset.completed = String(Boolean(task.completed))

    const toggleButton = createIconButton(task.completed ? CircleCheck : Circle, `Toggle ${task.text || 'task'}`)
    toggleButton.addEventListener('click', () => {
      const isCompleted = row.dataset.completed !== 'true'
      row.dataset.completed = String(isCompleted)
      toggleButton.setAttribute('aria-label', `Toggle ${input.value.trim() || 'task'}`)
      toggleButton.replaceChildren(makeIcon(isCompleted ? CircleCheck : Circle))
    })

    const input = document.createElement('input')
    input.type = 'text'
    input.required = true
    input.maxLength = 120
    input.autocomplete = 'off'
    input.value = task.text
    input.dataset.taskId = task.id ?? ''

    const deleteButton = createIconButton(Trash2, `Delete ${task.text || 'task'}`)
    deleteButton.classList.add('is-danger')
    deleteButton.addEventListener('click', () => row.remove())

    row.append(toggleButton, input, deleteButton)

    return row
  }

  function showDeleteFinishedDayConfirmation(day, onCancel = showFinishedDays) {
    content.replaceChildren()

    const confirmation = document.createElement('div')
    confirmation.className = 'delete-all-confirmation'

    const copy = document.createElement('p')
    copy.className = 'dialog-copy'
    copy.textContent = `${formatFinishedDayDate(day.date)} will be removed from Finished days.`

    const actions = document.createElement('div')
    actions.className = 'dialog-actions'

    const cancelButton = createDialogButton('Cancel', X)
    cancelButton.classList.add('is-secondary')
    cancelButton.type = 'button'
    cancelButton.addEventListener('click', onCancel)

    const deleteButton = createDialogButton('Delete', Trash2)
    deleteButton.classList.add('is-danger')
    deleteButton.type = 'button'
    deleteButton.addEventListener('click', () => {
      onDeleteFinishedDay(day.id)
      const index = finishedDays.findIndex((finishedDay) => finishedDay.id === day.id)

      if (index !== -1) {
        finishedDays.splice(index, 1)
      }

      showFinishedDays()
    })

    actions.append(cancelButton, deleteButton)
    confirmation.append(copy, actions)
    content.append(confirmation)
    cancelButton.focus()
  }

  savedListsTab.addEventListener('click', () => {
    modal.setTitle('Lists')
    showSavedLists()
  })
  finishedDaysTab.addEventListener('click', () => {
    modal.setTitle('Lists')
    showFinishedDays()
  })

  showSavedLists()
  modal.content.append(wrapper)
  modal.show()
}

export function openFinishDayDialog({ onConfirm, onCancel }) {
  let didConfirm = false
  const modal = createModal('Finish this day?', {
    onClose(reason) {
      if (reason !== 'confirm') {
        onCancel()
      }
    },
  })
  const content = document.createElement('div')
  content.className = 'delete-all-confirmation'

  const copy = document.createElement('p')
  copy.className = 'dialog-copy'
  copy.textContent = "Your current tasks will be moved to Finished days and today's list will reset."

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const cancelButton = createDialogButton('Cancel', X)
  cancelButton.classList.add('is-secondary')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', () => modal.close('cancel'))

  const finishButton = createDialogButton('Finish day', CalendarDays)
  finishButton.type = 'button'
  finishButton.addEventListener('click', () => {
    if (didConfirm) {
      return
    }

    didConfirm = true
    finishButton.disabled = true
    onConfirm()
    modal.close('confirm')
  })

  actions.append(cancelButton, finishButton)
  content.append(copy, actions)
  modal.content.append(content)
  modal.show()
  cancelButton.focus()
}

export function openSettingsPanel() {
  const modal = createModal('Settings')
  const panel = document.createElement('div')
  panel.className = 'settings-panel'

  const motionRow = createSettingsRow('Motion', 'System')
  const storageRow = createSettingsRow('Storage', 'This browser')
  const themeSection = createThemeSection()

  panel.append(motionRow, storageRow, themeSection)
  modal.content.append(panel)
  modal.show()
}

export function openDeleteAllTasksDialog({ onConfirm }) {
  const modal = createModal('Delete all tasks?')
  const content = document.createElement('div')
  content.className = 'delete-all-confirmation'

  const copy = document.createElement('p')
  copy.className = 'dialog-copy'
  copy.textContent = 'This will remove every task from this list.'

  const actions = document.createElement('div')
  actions.className = 'dialog-actions'

  const cancelButton = createDialogButton('Cancel', X)
  cancelButton.classList.add('is-secondary')
  cancelButton.type = 'button'
  cancelButton.addEventListener('click', () => modal.close())

  const deleteButton = createDialogButton('Delete all', Trash2)
  deleteButton.classList.add('is-danger')
  deleteButton.type = 'button'
  deleteButton.addEventListener('click', () => {
    onConfirm()
    modal.close()
  })

  actions.append(cancelButton, deleteButton)
  content.append(copy, actions)
  modal.content.append(content)
  modal.show()
  cancelButton.focus()
}

function createModal(titleText, options = {}) {
  const overlay = document.createElement('div')
  overlay.className = 'taskly-modal'
  overlay.setAttribute('role', 'presentation')

  const dialog = document.createElement('section')
  dialog.className = 'taskly-dialog chunky-panel'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', 'taskly-dialog-title')

  const header = document.createElement('div')
  header.className = 'taskly-dialog-header'

  const title = document.createElement('h2')
  title.id = 'taskly-dialog-title'
  title.textContent = titleText

  const closeButton = createIconButton(X, 'Close dialog')
  closeButton.addEventListener('click', () => close())

  const content = document.createElement('div')
  content.className = 'taskly-dialog-content'

  header.append(title, closeButton)
  dialog.append(header, content)
  overlay.append(dialog)
  let isClosing = false

  function close(reason = 'dismiss') {
    if (isClosing) {
      return
    }

    isClosing = true
    document.removeEventListener('keydown', handleKeydown)
    animateModalClose(overlay, dialog, () => {
      overlay.remove()
      options.onClose?.(reason)
    })
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      close()
    }
  }

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close()
    }
  })

  document.addEventListener('keydown', handleKeydown)

  return {
    content,
    close,
    setTitle(nextTitle) {
      title.textContent = nextTitle
    },
    show() {
      document.body.append(overlay)
      animateModalOpen(overlay, dialog)
    },
  }
}

function createSettingsRow(labelText, valueText) {
  const row = document.createElement('div')
  row.className = 'settings-row'

  const label = document.createElement('span')
  label.className = 'settings-row-label'
  label.textContent = labelText

  const value = document.createElement('span')
  value.className = 'settings-row-value'
  value.textContent = valueText

  row.append(label, value)

  return row
}

function createThemeSection() {
  const section = document.createElement('section')
  section.className = 'settings-theme-section'
  section.setAttribute('aria-labelledby', 'settings-theme-title')

  const title = document.createElement('h3')
  title.id = 'settings-theme-title'
  title.className = 'settings-section-title'
  title.textContent = 'Theme'

  const grid = document.createElement('div')
  grid.className = 'theme-options'

  const selectedThemeId = loadThemeId()

  themes.forEach((theme) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'theme-option'
    button.dataset.themeOption = theme.id
    button.setAttribute('aria-pressed', String(theme.id === selectedThemeId))
    button.classList.toggle('is-selected', theme.id === selectedThemeId)

    const swatches = document.createElement('span')
    swatches.className = 'theme-swatches'
    swatches.setAttribute('aria-hidden', 'true')

    theme.swatches.forEach((color) => {
      const swatch = document.createElement('span')
      swatch.className = 'theme-swatch'
      swatch.style.background = color
      swatches.append(swatch)
    })

    const name = document.createElement('span')
    name.className = 'theme-name'
    name.textContent = theme.name

    button.append(swatches, name)
    button.addEventListener('click', () => {
      applyTheme(theme.id)
      updateThemeSelection(grid, theme.id)
    })

    grid.append(button)
  })

  section.append(title, grid)

  return section
}

function updateThemeSelection(grid, selectedThemeId) {
  grid.querySelectorAll('.theme-option').forEach((button) => {
    const isSelected = button.dataset.themeOption === selectedThemeId

    button.classList.toggle('is-selected', isSelected)
    button.setAttribute('aria-pressed', String(isSelected))
  })
}

function createDialogButton(label, iconNode) {
  const button = document.createElement('button')
  button.className = 'dialog-button'
  button.append(makeIcon(iconNode), document.createTextNode(label))

  return button
}

function createTabButton(label, isActive) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `lists-tab${isActive ? ' is-active' : ''}`
  button.setAttribute('role', 'tab')
  button.setAttribute('aria-selected', String(isActive))
  button.textContent = label

  return button
}

function createEmptyMessage(message) {
  const empty = document.createElement('p')
  empty.className = 'saved-lists-empty'
  empty.textContent = message

  return empty
}

function createFinishedDayRow(day, handlers) {
  const row = document.createElement('div')
  row.className = 'finished-day-row'

  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'finished-day-open'
  openButton.addEventListener('click', handlers.onOpen)

  const title = document.createElement('span')
  title.className = 'finished-day-title'
  title.textContent = formatFinishedDayDate(day.date)

  const progress = document.createElement('span')
  progress.className = 'finished-day-progress-text'
  progress.textContent = `${day.completedCount} / ${day.totalCount} completed`

  const progressTrack = document.createElement('span')
  progressTrack.className = 'finished-day-progress-track'
  progressTrack.setAttribute('aria-hidden', 'true')

  const progressFill = document.createElement('span')
  progressFill.className = 'finished-day-progress-fill'
  progressFill.style.width = `${getFinishedDayProgress(day)}%`

  progressTrack.append(progressFill)
  openButton.append(title, progress, progressTrack)

  const deleteButton = createIconButton(Trash2, `Delete ${formatFinishedDayDate(day.date)}`)
  deleteButton.classList.add('is-danger')
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation()
    handlers.onDelete()
  })

  row.append(openButton, deleteButton)

  return row
}

function getFinishedDayProgress(day) {
  return day.totalCount > 0 ? Math.round((day.completedCount / day.totalCount) * 100) : 0
}

function formatFinishedDayDate(date) {
  const parsedDate = new Date(date)

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Finished day'
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(parsedDate)
}

function createIconButton(iconNode, label) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'icon-button'
  button.setAttribute('aria-label', label)
  button.append(makeIcon(iconNode))

  return button
}

function showDialogError(error, message) {
  error.textContent = message
  error.hidden = false
}
