export const SCHEMA_VERSION = 1
export const THEMES = Object.freeze(['plum', 'forest', 'ocean', 'rose', 'midnight'])
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const string = (value, max = 1500) => typeof value === 'string' && value.length > 0 && value.length <= max
const integer = (value) => Number.isSafeInteger(value) && value >= 0
function requireThat(condition, message) {
  if (!condition) throw new Error(message)
}

export function validId(value) {
  return string(value) && !value.includes('/') && !['.', '..'].includes(value) && !/^__.*__$/.test(value)
    && new TextEncoder().encode(value).length <= 1500
}

export function validDateKey(value) {
  if (typeof value !== 'string' || !datePattern.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function describeDocument(path) {
  requireThat(typeof path === 'string', 'A relative document path is required.')
  if (path === '') return { kind: 'user' }
  const parts = path.split('/')
  requireThat(parts.every(validId), 'Invalid document path.')
  const [collection, id, child, taskId] = parts
  if (parts.length === 2) {
    if (collection === 'days' && validDateKey(id)) return { kind: 'day', id }
    if (collection === 'savedLists') return { kind: 'savedList', id }
    if (collection === 'finishedDays') return { kind: 'finishedDay', id }
    if (collection === 'preferences' && id === 'general') return { kind: 'preferences', id }
    if (collection === 'imports') return { kind: 'import', id }
  }
  if (parts.length === 4 && child === 'tasks' && ['days', 'savedLists', 'finishedDays'].includes(collection)) {
    requireThat(collection !== 'days' || validDateKey(id), 'Invalid day date key.')
    return { kind: 'task', id: taskId }
  }
  throw new Error('Unsupported document path.')
}

export function validateCollection(path) {
  requireThat(typeof path === 'string', 'A relative collection path is required.')
  if (['days', 'savedLists', 'finishedDays', 'preferences', 'imports'].includes(path)) return path
  const parts = path.split('/')
  requireThat(parts.length === 3 && parts[2] === 'tasks', 'Unsupported collection path.')
  requireThat(['day', 'savedList', 'finishedDay'].includes(describeDocument(parts.slice(0, 2).join('/')).kind), 'Unsupported task collection.')
  return path
}

// Strict field sets mirror the rules. Invalid data is rejected, never normalized.
export function validateDocument(uid, path, data) {
  requireThat(validId(uid), 'A valid account UID is required.')
  const { kind, id } = describeDocument(path)
  const fields = {
    user: [], day: ['dateKey', 'currentListId'], task: ['id', 'text', 'completed', 'order'],
    savedList: ['id', 'name', 'createdAt', 'updatedAt', 'order'],
    finishedDay: ['id', 'dateKey', 'date', 'createdAt', 'completedCount', 'totalCount', 'order'],
    preferences: ['themeId'], import: ['id', 'sourceId', 'backupHash', 'status', 'createdAt', 'completedAt'],
  }[kind].concat(['schemaVersion', 'ownerId'])
  requireThat(record(data) && Object.keys(data).length === fields.length
    && fields.every((key) => Object.hasOwn(data, key)), 'Unexpected or missing document fields.')
  requireThat(data.schemaVersion === SCHEMA_VERSION && data.ownerId === uid, 'Invalid schema version or document owner.')
  if (['task', 'savedList', 'finishedDay', 'import'].includes(kind)) requireThat(data.id === id, 'Document ID does not match its path.')
  if (kind === 'day') requireThat(data.dateKey === id && (data.currentListId === null || validId(data.currentListId)), 'Invalid day or saved-list reference.')
  if (kind === 'task') requireThat(string(data.text, 10000) && typeof data.completed === 'boolean' && integer(data.order), 'Invalid task.')
  if (kind === 'savedList') requireThat(string(data.name, 200) && string(data.createdAt, 64) && string(data.updatedAt, 64) && integer(data.order), 'Invalid saved list.')
  if (kind === 'finishedDay') requireThat(validDateKey(data.dateKey) && string(data.date, 64) && string(data.createdAt, 64)
    && integer(data.completedCount) && integer(data.totalCount) && data.completedCount <= data.totalCount && integer(data.order), 'Invalid finished day.')
  if (kind === 'preferences') requireThat(THEMES.includes(data.themeId), 'Unknown theme.')
  if (kind === 'import') requireThat(validId(data.sourceId) && typeof data.backupHash === 'string' && /^[a-f0-9]{64}$/.test(data.backupHash)
    && ['pending', 'complete'].includes(data.status) && string(data.createdAt, 64)
    && (data.status === 'pending' ? data.completedAt === null : string(data.completedAt, 64)), 'Invalid import tracking record.')
  return data
}

// Pure planning utility for a later, explicitly confirmed import. It never reads
// localStorage, creates IDs, converts timestamps, or performs database operations.
export function mapLocalStateToDocuments(state, { uid, themeId, finishedDayDateKeys = {} }) {
  requireThat(record(state) && record(state.tasksByDate) && record(state.currentListIdsByDate)
    && Array.isArray(state.savedLists) && Array.isArray(state.finishedDays), 'Invalid local state.')
  const documents = []
  const paths = new Set()
  const add = (path, data) => {
    requireThat(!paths.has(path), 'Duplicate ID in the same collection.')
    paths.add(path)
    const full = { schemaVersion: SCHEMA_VERSION, ownerId: uid, ...data }
    validateDocument(uid, path, full)
    documents.push({ path, data: full })
  }
  const taskDocuments = (parent, tasks) => {
    requireThat(Array.isArray(tasks), 'Expected a task snapshot array.')
    tasks.forEach((task, order) => {
      requireThat(record(task) && validId(task.id), 'Invalid task ID.')
      add(`${parent}/tasks/${task.id}`, { id: task.id, text: task.text, completed: task.completed, order })
    })
  }
  add('', {})
  const listIds = new Set(state.savedLists.map((list) => list.id))
  for (const dateKey of new Set([...Object.keys(state.tasksByDate), ...Object.keys(state.currentListIdsByDate)])) {
    const currentListId = state.currentListIdsByDate[dateKey] ?? null
    requireThat(currentListId === null || listIds.has(currentListId), 'Dangling saved-list reference requires review.')
    add(`days/${dateKey}`, { dateKey, currentListId })
    taskDocuments(`days/${dateKey}`, state.tasksByDate[dateKey] ?? [])
  }
  state.savedLists.forEach((list, order) => {
    add(`savedLists/${list.id}`, { id: list.id, name: list.name, createdAt: list.createdAt, updatedAt: list.updatedAt, order })
    taskDocuments(`savedLists/${list.id}`, list.tasks)
  })
  state.finishedDays.forEach((day, order) => {
    // Legacy ISO timestamps cannot safely identify the original local day.
    requireThat(!day.dateKey || !finishedDayDateKeys[day.id] || day.dateKey === finishedDayDateKeys[day.id], 'Conflicting finished-day date keys require review.')
    const dateKey = day.dateKey ?? finishedDayDateKeys[day.id] ?? (validDateKey(day.date) ? day.date : undefined)
    requireThat(validDateKey(dateKey), 'An explicit original date key is required for each finished day.')
    requireThat(!validDateKey(day.date) || day.date === dateKey, 'Finished-day date does not match its date key.')
    requireThat(Array.isArray(day.tasks) && day.totalCount === day.tasks.length
      && day.completedCount === day.tasks.filter((task) => task.completed === true).length, 'Finished-day counts do not match its snapshot.')
    add(`finishedDays/${day.id}`, { id: day.id, dateKey, date: day.date, createdAt: day.createdAt, completedCount: day.completedCount, totalCount: day.totalCount, order })
    taskDocuments(`finishedDays/${day.id}`, day.tasks)
  })
  add('preferences/general', { themeId })
  return documents
}
