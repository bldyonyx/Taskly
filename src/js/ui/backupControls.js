import {
  createBackup, downloadBackup, parseBackup, readRecovery, recoverPendingRestore, restoreBackup,
} from '../storage/backup.js'

// Run before the existing loaders can normalize or persist any data.
export function prepareLocalData() {
  try {
    recoverPendingRestore()
  } catch {
    document.querySelectorAll('.taskly-modal').forEach((modal) => modal.remove())
    const panel = document.createElement('section')
    panel.className = 'taskly-dialog chunky-panel'
    const title = document.createElement('h2')
    title.textContent = 'Taskly data recovery'
    const message = document.createElement('p')
    message.className = 'dialog-copy'
    message.textContent = 'Taskly could not complete data recovery. Editing is paused to protect your data. Free browser storage if needed, then retry. You can download the saved recovery copy first.'
    const download = button('Download recovery copy')
    download.addEventListener('click', () => {
      try {
        const recovery = readRecovery()
        if (!recovery) throw new Error('No recovery copy is available.')
        downloadBackup(recovery.backup, 'recovery')
      } catch {
        message.textContent = 'The recovery copy could not be read. Keep this browser data intact and try again when browser storage is available.'
      }
    })
    const retry = button('Retry recovery')
    retry.addEventListener('click', () => window.location.reload())
    panel.append(title, message, download, retry)
    document.querySelector('#app').replaceChildren(panel)
    return false
  }
  return true
}

function button(label) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'dialog-button is-secondary'
  element.textContent = label
  return element
}

export function createBackupSection() {
  const section = document.createElement('section')
  section.className = 'settings-theme-section'
  const title = document.createElement('h3')
  title.className = 'settings-section-title'
  title.textContent = 'Data backup'
  const copy = document.createElement('p')
  copy.className = 'dialog-copy'
  copy.textContent = 'Save a copy of this browser’s Taskly data. Backups contain your task text; keep them somewhere private.'
  const actions = document.createElement('div')
  actions.className = 'dialog-actions'
  const status = document.createElement('p')
  status.className = 'dialog-copy'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  const exportButton = button('Export data')
  const importButton = button('Import data')
  const recoveryButton = button('Download recovery copy')
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'
  input.hidden = true
  input.setAttribute('aria-label', 'Choose a Taskly JSON backup')
  const confirmation = document.createElement('div')
  confirmation.hidden = true
  const warning = document.createElement('p')
  warning.className = 'dialog-copy'
  warning.textContent = 'Replace all current local tasks, calendar data, saved lists, finished days, and theme with this backup? Keys marked absent in the backup will be removed. A recovery copy of your current data will be saved first. Close other Taskly tabs before restoring. Taskly will reload after restoration.'
  const confirmActions = document.createElement('div')
  confirmActions.className = 'dialog-actions'
  const confirm = button('Replace local data')
  confirm.classList.add('is-danger')
  confirm.classList.remove('is-secondary')
  const cancel = button('Cancel')
  let pendingBackup = null
  let reading = false

  exportButton.addEventListener('click', () => {
    try {
      downloadBackup(createBackup())
      status.textContent = 'Backup download requested. Check your downloads before making changes.'
    } catch {
      status.textContent = 'Could not export data. Your stored data has not been changed.'
    }
  })
  recoveryButton.addEventListener('click', () => {
    try {
      const recovery = readRecovery()
      if (!recovery) throw new Error('No recovery copy is available yet. A copy is saved before each restore.')
      downloadBackup(recovery.backup, 'recovery')
      status.textContent = 'Recovery download requested.'
    } catch (error) {
      status.textContent = error.message
    }
  })
  importButton.addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    input.value = ''
    if (!file || reading) return
    reading = true
    importButton.disabled = true
    pendingBackup = null
    confirmation.hidden = true
    try {
      pendingBackup = parseBackup(await file.text())
      status.textContent = 'Backup validated. No data has been replaced.'
      confirmation.hidden = false
      confirm.focus()
    } catch (error) {
      status.textContent = error.message
    } finally {
      reading = false
      importButton.disabled = false
    }
  })
  cancel.addEventListener('click', () => {
    pendingBackup = null
    confirmation.hidden = true
    status.textContent = 'Import cancelled. No data was replaced.'
    importButton.focus()
  })
  confirm.addEventListener('click', () => {
    if (!pendingBackup) return
    confirm.disabled = true
    try {
      restoreBackup(pendingBackup)
      window.location.reload()
    } catch (error) {
      status.textContent = error.message
      // Incomplete rollback must stop normal app writes until recovery succeeds.
      prepareLocalData()
      pendingBackup = null
      confirmation.hidden = true
      confirm.disabled = false
    }
  })
  confirmActions.append(cancel, confirm)
  confirmation.append(warning, confirmActions)
  actions.append(exportButton, importButton, recoveryButton)
  section.append(title, copy, actions, input, status, confirmation)
  return section
}
