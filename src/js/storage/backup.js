export const BACKUP_KEYS = Object.freeze([
  'taskly.tasks.v1',
  'taskly.tasksByDate.v1',
  'taskly.currentListByDate.v1',
  'taskly.savedLists.v1',
  'taskly.currentListId.v1',
  'taskly.finishedDays.v1',
  'taskly.theme.v1',
])

export const RECOVERY_KEY = 'taskly.backupRecovery.v1'

export function validateBackup(backup) {
  if (!backup || backup.format !== 'taskly-local-backup') {
    throw new Error('This is not a Taskly backup.')
  }
  if (backup.version !== 1) {
    throw new Error('This backup version is not supported.')
  }
  if (typeof backup.exportedAt !== 'string' || !Number.isFinite(Date.parse(backup.exportedAt))) {
    throw new Error('The backup date is invalid.')
  }
  const values = backup.values
  if (!values || typeof values !== 'object' || Array.isArray(values)
    || Object.keys(values).length !== BACKUP_KEYS.length
    || BACKUP_KEYS.some((key) => !Object.hasOwn(values, key)
      || (values[key] !== null && typeof values[key] !== 'string'))) {
    throw new Error('The backup must contain all seven Taskly keys, each as a string or null.')
  }
  return backup
}

export function parseBackup(text) {
  let backup
  try {
    backup = JSON.parse(text)
  } catch {
    throw new Error('The selected file is not valid JSON.')
  }
  return validateBackup(backup)
}

export function createBackup(storage = localStorage) {
  return {
    format: 'taskly-local-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    values: Object.fromEntries(BACKUP_KEYS.map((key) => [key, storage.getItem(key)])),
  }
}

export function readRecovery(storage = localStorage) {
  const raw = storage.getItem(RECOVERY_KEY)
  if (raw === null) return null
  const recovery = JSON.parse(raw)
  if (!recovery || !['pending', 'complete'].includes(recovery.status)) {
    throw new Error('The recovery record is invalid.')
  }
  validateBackup(recovery.backup)
  return recovery
}

function writeRecovery(storage, recovery) {
  const raw = JSON.stringify(recovery)
  storage.setItem(RECOVERY_KEY, raw)
  if (storage.getItem(RECOVERY_KEY) !== raw) throw new Error('Could not verify the recovery copy.')
}

function replaceValues(storage, values) {
  // Skip unchanged values; attempt every key even if one storage operation fails.
  let failed = false
  for (const key of BACKUP_KEYS) {
    try {
      if (storage.getItem(key) === values[key]) continue
      if (values[key] === null) storage.removeItem(key)
      else storage.setItem(key, values[key])
      if (storage.getItem(key) !== values[key]) failed = true
    } catch {
      failed = true
    }
  }
  if (failed) throw new Error('Could not write every Taskly value.')
}

export function recoverPendingRestore(storage = localStorage) {
  const recovery = readRecovery(storage)
  if (recovery?.status !== 'pending') return false
  replaceValues(storage, recovery.backup.values)
  writeRecovery(storage, { ...recovery, status: 'complete' })
  return true
}

export function restoreBackup(backup, storage = localStorage) {
  // Serialize and parse to validate and detach caller-owned objects before writing.
  const incoming = parseBackup(JSON.stringify(backup))
  recoverPendingRestore(storage)
  const recovery = { status: 'pending', backup: createBackup(storage) }
  // A durable, verified recovery copy is required before touching the seven keys.
  try {
    writeRecovery(storage, recovery)
  } catch {
    throw new Error('Could not save a recovery copy. Your current Taskly data has not been replaced.')
  }
  try {
    replaceValues(storage, incoming.values)
    writeRecovery(storage, { ...recovery, status: 'complete' })
  } catch {
    try {
      replaceValues(storage, recovery.backup.values)
      writeRecovery(storage, { ...recovery, status: 'complete' })
    } catch {
      throw new Error('Restore failed and recovery could not finish. Stop editing and download the recovery copy. Reload to retry recovery.')
    }
    throw new Error('Restore failed. Your previous Taskly data was recovered; the recovery copy is also available below.')
  }
}

export function downloadBackup(backup, label = 'backup') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(validateBackup(backup), null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `taskly-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
