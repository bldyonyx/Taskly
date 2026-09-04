import { FolderOpen, Save, Trash2, X } from 'lucide'
import { animateModalClose, animateModalOpen } from '../animations/animations.js'
import { makeIcon } from './icons.js'

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

export function openSavedListsDialog({ lists, currentListId, onLoad, onDelete, onUpdate }) {
  const modal = createModal('Saved lists')
  const wrapper = document.createElement('div')
  wrapper.className = 'saved-lists-panel'

  if (lists.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'saved-lists-empty'
    empty.textContent = 'No saved lists yet.'
    wrapper.append(empty)
  } else {
    lists.forEach((list) => {
      const row = document.createElement('div')
      row.className = `saved-list-row${list.id === currentListId ? ' is-current' : ''}`

      const loadButton = document.createElement('button')
      loadButton.type = 'button'
      loadButton.className = 'saved-list-load'
      loadButton.append(makeIcon(FolderOpen, 'saved-list-icon'), document.createTextNode(list.name))
      loadButton.addEventListener('click', () => {
        onLoad(list.id)
        modal.close()
      })

      const updateButton = createIconButton(Save, `Update ${list.name}`)
      updateButton.addEventListener('click', (event) => {
        event.stopPropagation()
        onUpdate(list.id)
        modal.close()
      })

      const deleteButton = createIconButton(Trash2, `Delete ${list.name}`)
      deleteButton.classList.add('is-danger')
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation()
        onDelete(list.id)
        row.remove()

        if (wrapper.querySelectorAll('.saved-list-row').length === 0) {
          wrapper.replaceChildren()
          const empty = document.createElement('p')
          empty.className = 'saved-lists-empty'
          empty.textContent = 'No saved lists yet.'
          wrapper.append(empty)
        }
      })

      row.append(loadButton, updateButton, deleteButton)
      wrapper.append(row)
    })
  }

  modal.content.append(wrapper)
  modal.show()
}

export function openSettingsPanel() {
  const modal = createModal('Settings')
  const panel = document.createElement('div')
  panel.className = 'settings-panel'

  const motionRow = createSettingsRow('Motion', 'System')
  const storageRow = createSettingsRow('Storage', 'This browser')

  panel.append(motionRow, storageRow)
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

function createModal(titleText) {
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

  function close() {
    if (isClosing) {
      return
    }

    isClosing = true
    document.removeEventListener('keydown', handleKeydown)
    animateModalClose(overlay, dialog, () => overlay.remove())
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

function createDialogButton(label, iconNode) {
  const button = document.createElement('button')
  button.className = 'dialog-button'
  button.append(makeIcon(iconNode), document.createTextNode(label))

  return button
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
