import '../styles/themes.css'
import '../styles/base.css'
import '../styles/layout.css'
import '../styles/components.css'
import '../styles/animations.css'
import './test-mode.css'
import { assertIsolatedRuntime } from './config.js'
import { createIsolatedController } from './controller.js'
import { localRepository } from '../js/storage/repository.js'
import { prepareLocalData } from '../js/ui/backupControls.js'
import { applyTheme } from '../js/ui/themes.js'
import { createTask, defaultTasks, reorderTasksByIds } from '../js/tasks/taskManager.js'
import { createSavedList, updateSavedList, createActiveTasksFromSavedList } from '../js/lists/savedLists.js'
import { createFinishedDay, updateFinishedDay, findFinishedDayByDateKey, getFinishedDayDateKeys,
  createActiveTasksFromFinishedDay } from '../js/lists/finishedDays.js'
import { getDateKey, parseDateKey, renderDate, getAccessibleDateLabel } from '../js/utils/date.js'
import { renderTasks } from '../js/tasks/taskRenderer.js'
import { renderProgress } from '../js/ui/progress.js'
import { getEditIcon, getTaskStateIcon, getTrashIcon, renderStaticIcons } from '../js/ui/icons.js'
import { createTaskSorter } from '../js/sortable/sortable.js'
import { openSettingsPanel, openCalendarDialog, openSavedListsDialog, openSaveListDialog,
  openFinishDayDialog, openDeleteAllTasksDialog, renderCurrentListLabel, closeAllModals } from '../js/ui/modals.js'

const guard = { enabled: typeof __TASKLY_ISOLATED_CLOUD__ !== 'undefined' && __TASKLY_ISOLATED_CLOUD__,
  dev: import.meta.env.DEV, mode: import.meta.env.MODE, hostname: location.hostname }
let runtime
try {
  assertIsolatedRuntime(guard)
  const { createIsolatedRuntime } = await import('./firebase.js')
  runtime = await createIsolatedRuntime(guard)
} catch (error) {
  const failure = document.createElement('p')
  failure.setAttribute('role', 'alert')
  failure.textContent = 'ISOLATED TEST startup failed. Check the fixed loopback emulator configuration; no live Firebase fallback is available.'
  document.body.replaceChildren(failure)
  throw error
}
const today = getDateKey()
const controller = createIsolatedController({ session: runtime.session, createAccount: runtime.account,
  readGuest() {
    if (!prepareLocalData()) throw new Error('Guest recovery required.')
    return { data: localRepository.loadState(today, defaultTasks), theme: localRepository.loadTheme() }
  },
  writeGuest(data, fields, theme) {
    if (fields.includes('tasks')) localRepository.saveTasksByDate(data.tasksByDate)
    if (fields.includes('lists')) localRepository.saveSavedLists(data.savedLists)
    if (fields.includes('finished')) localRepository.saveFinishedDays(data.finishedDays)
    if (fields.includes('references')) localRepository.saveCurrentListIdsByDate(today, data.currentListIdsByDate)
    if (theme) localRepository.saveTheme(theme)
  },
})
const $ = (selector) => document.querySelector(selector)
const elements = { list: $('#task-list'), empty: $('#empty-state'), count: $('#task-count'),
  fill: $('#progress-fill'), track: $('.progress-track'), weekday: $('#date-weekday'), day: $('#date-day'), month: $('#date-month') }
const banner = document.createElement('section')
banner.dataset.cloudTest = 'emulators'
banner.setAttribute('aria-label', 'Isolated cloud test controls')
const label = document.createElement('strong')
label.textContent = 'ISOLATED TEST — local Auth + Firestore emulators only'
const status = document.createElement('p')
status.id = 'cloud-test-status'
status.setAttribute('role', 'status')
status.setAttribute('aria-live', 'polite')
const refresh = document.createElement('button')
refresh.type = 'button'; refresh.textContent = 'Reload account data'
refresh.addEventListener('click', () => { closeAllModals(); void controller.refresh() })
const initialize = document.createElement('button')
initialize.type = 'button'; initialize.textContent = 'Initialize audited empty emulator account'
initialize.addEventListener('click', () => { void controller.initialize() })
banner.append(label, status, refresh, initialize)
$('#app').prepend(banner)
document.title = 'Taskly — ISOLATED EMULATOR TEST'
let selectedDate = today
let epoch = -1
let dragging = false
let dragContext
const state = () => controller.getState()
const data = () => state().data
const archived = () => findFinishedDayByDateKey(data().finishedDays, selectedDate)
const tasks = () => archived()?.tasks ?? data().tasksByDate[selectedDate] ?? []
const currentList = () => data().savedLists.find((list) => list.id === data().currentListIdsByDate[selectedDate]) ?? null
const ready = () => ['ready', 'saved'].includes(state().phase)
const editable = () => ready() && !(state().kind === 'account' && archived())
function bind(fn) {
  const token = state().epoch
  return (...args) => { if (token === state().epoch) return fn(...args) }
}
function notice(message) { status.textContent = `ISOLATED TEST: ${message}` }
function run(operation) {
  closeAllModals()
  return controller.mutate(operation)
}
function guest(dataCopy, fields) { return controller.saveGuest(dataCopy, fields) }
function changeTasks(next, listId = currentList()?.id ?? null) {
  if (!editable()) { if (archived() && state().kind === 'account') notice('Archived Finished Days are read-only. Select an unfinished date first.'); return false }
  if (state().kind === 'account') {
    const date = selectedDate
    return run((account, revision) => account.replaceDatedTasks(date, next, listId, revision))
  }
  const copy = structuredClone(data())
  const finished = archived()
  if (finished) {
    copy.finishedDays = copy.finishedDays.map((day) => day.id === finished.id ? updateFinishedDay(day, next) : day)
    return guest(copy, ['finished'])
  }
  copy.tasksByDate[selectedDate] = next
  if (listId) copy.currentListIdsByDate[selectedDate] = listId
  else delete copy.currentListIdsByDate[selectedDate]
  return guest(copy, ['tasks', 'references'])
}
function render(view) {
  if (view.epoch !== epoch) {
    epoch = view.epoch
    closeAllModals()
    selectedDate = today
    dragging = false; dragContext = null
    $('#new-task').value = ''
  }
  banner.dataset.phase = view.phase
  banner.dataset.kind = view.kind
  banner.dataset.uid = view.uid ?? ''
  banner.dataset.revision = view.revision === null ? '' : String(view.revision)
  status.textContent = view.message
  refresh.hidden = view.kind !== 'account'
  refresh.disabled = ['loading', 'saving'].includes(view.phase)
  initialize.hidden = view.phase !== 'uninitialized'
  renderTasks(tasks(), elements, {
    canToggle: () => editable() && !dragging,
    onToggle: bind((id) => changeTasks(tasks().map((task) => task.id === id ? { ...task, completed: !task.completed } : task))),
    onRemove: bind((id) => changeTasks(tasks().filter((task) => task.id !== id))),
    onEdit: bind((id, text) => { if (!editable()) return false; void changeTasks(tasks().map((task) => task.id === id ? { ...task, text } : task)); return true }),
  }, { getEditIcon, getTaskStateIcon, getTrashIcon })
  renderProgress(tasks(), elements)
  renderDate(elements, parseDateKey(selectedDate))
  $('#date-card').setAttribute('aria-label', `Open calendar, selected date ${getAccessibleDateLabel(parseDateKey(selectedDate))}`)
  renderCurrentListLabel($('#current-list-label'), currentList(), false)
  applyTheme(view.theme)
  for (const selector of ['#new-task', '#task-form button', '#uncheck-all', '#delete-all', '#finish-day', '#save-list']) {
    $(selector).disabled = !editable()
  }
  $('#finish-day').disabled ||= Boolean(archived()) || tasks().length === 0
  $('#saved-lists').disabled = !ready()
  for (const button of elements.list.querySelectorAll('button')) button.disabled = !editable()
}
controller.subscribe(render)
$('#task-form').addEventListener('submit', (event) => {
  event.preventDefault()
  const task = createTask($('#new-task').value)
  if (!editable() || !task.text) return
  $('#new-task').value = ''
  void changeTasks([task, ...tasks()])
})
$('#uncheck-all').addEventListener('click', () => { void changeTasks(tasks().map((task) => ({ ...task, completed: false }))) })
$('#delete-all').addEventListener('click', () => {
  if (editable()) openDeleteAllTasksDialog({ onConfirm: bind(() => { void changeTasks([]) }) })
})
$('#finish-day').addEventListener('click', () => {
  if (!editable() || archived() || tasks().length === 0) return
  openFinishDayDialog({ dateLabel: getAccessibleDateLabel(parseDateKey(selectedDate)), onCancel() {}, onConfirm: bind(() => {
    if (state().kind === 'account') {
      const date = selectedDate
      void run((account, revision) => account.finishDay(date, { id: crypto.randomUUID(), createdAt: new Date().toISOString(), order: data().finishedDays.length }, revision))
    } else {
      const copy = structuredClone(data())
      copy.finishedDays.unshift(createFinishedDay(tasks(), parseDateKey(selectedDate)))
      copy.tasksByDate[selectedDate] = []
      delete copy.currentListIdsByDate[selectedDate]
      guest(copy, ['tasks', 'finished', 'references'])
    }
  }) })
})
function saveList(name, existing) {
  if (!ready()) return
  const record = existing ? updateSavedList(existing, tasks(), name) : createSavedList(name, tasks())
  if (state().kind === 'account') {
    const date = selectedDate
    void run((account, revision) => existing ? account.replaceSavedList(record, revision)
      : account.saveListForDate({ ...record, order: data().savedLists.length }, date, revision))
  } else {
    const copy = structuredClone(data())
    copy.savedLists = existing ? copy.savedLists.map((list) => list.id === record.id ? record : list) : [record, ...copy.savedLists]
    copy.currentListIdsByDate[selectedDate] = record.id
    guest(copy, ['lists', 'references'])
  }
}
$('#save-list').addEventListener('click', () => {
  if (editable()) openSaveListDialog({ currentList: currentList(), onSaveNew: bind((name) => saveList(name)),
    onUpdateCurrent: bind((name) => saveList(name, currentList())) })
})
$('#saved-lists').addEventListener('click', () => {
  if (!ready()) return
  openSavedListsDialog({ lists: structuredClone(data().savedLists), finishedDays: structuredClone(data().finishedDays), currentListId: currentList()?.id,
    hasCurrentTasks: tasks().length > 0, canEditFinishedDays: state().kind === 'guest',
    onLoad: bind((id, mode) => { const list = data().savedLists.find((item) => item.id === id); if (list) void changeTasks([...(mode === 'append' ? tasks() : []), ...createActiveTasksFromSavedList(list)], id) }),
    onLoadFinishedDay: bind((id, mode) => { const day = data().finishedDays.find((item) => item.id === id); if (day) void changeTasks([...(mode === 'append' ? tasks() : []), ...createActiveTasksFromFinishedDay(day)], null) }),
    onEdit: bind((id, editedTasks, name) => {
      const existing = data().savedLists.find((list) => list.id === id)
      if (!existing) return
      const record = updateSavedList(existing, editedTasks, name)
      if (state().kind === 'account') void run((account, revision) => account.replaceSavedList(record, revision))
      else { const copy = structuredClone(data()); copy.savedLists = copy.savedLists.map((list) => list.id === id ? record : list); guest(copy, ['lists']) }
    }),
    onDelete: bind((id) => {
      if (state().kind === 'account') void run((account, revision) => account.deleteSavedList(id, revision))
      else {
        const copy = structuredClone(data()); copy.savedLists = copy.savedLists.filter((list) => list.id !== id)
        copy.currentListIdsByDate = Object.fromEntries(Object.entries(copy.currentListIdsByDate).filter(([, value]) => value !== id))
        guest(copy, ['lists', 'references'])
      }
    }),
    onDeleteFinishedDay: bind((id) => {
      if (state().kind === 'account') void run((account, revision) => account.deleteFinishedDay(id, revision))
      else { const copy = structuredClone(data()); copy.finishedDays = copy.finishedDays.filter((day) => day.id !== id); guest(copy, ['finished']) }
    }),
    onEditFinishedDay: bind((id, editedTasks) => {
      if (state().kind !== 'guest') { notice('Finished Day editing is blocked in cloud tests.'); return }
      const copy = structuredClone(data()); copy.finishedDays = copy.finishedDays.map((day) => day.id === id ? updateFinishedDay(day, editedTasks) : day)
      guest(copy, ['finished'])
    }),
  })
})
function openCalendar() {
  if (!ready()) return
  openCalendarDialog({ selectedDateKey: selectedDate, todayKey: today,
    taskDateKeys: Object.entries(data().tasksByDate).filter(([, values]) => values.length).map(([date]) => date),
    finishedDayDateKeys: getFinishedDayDateKeys(data().finishedDays),
    onSelect: bind((date) => { selectedDate = date; render(state()) }),
  })
}
$('#date-card').addEventListener('click', openCalendar)
$('#date-card').addEventListener('keydown', (event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); openCalendar() } })
$('.settings-button').addEventListener('click', () => openSettingsPanel({ session: runtime.session,
  accountNote: 'ISOLATED TEST: accounts use local emulators; guest data stays on this browser.',
  localBackup: state().kind === 'guest', appearance: {
    load: () => state().theme,
    select: bind((theme) => state().kind === 'guest' ? controller.saveGuest(data(), [], theme) : run((account) => account.saveTheme(theme))),
  },
}))
createTaskSorter(elements.list, {
  onDragStart() { dragging = true; dragContext = { epoch: state().epoch, revision: state().revision, date: selectedDate } },
  onReorder(ids) {
    const captured = dragContext
    dragging = false
    if (!editable() || !captured || captured.epoch !== state().epoch || captured.date !== selectedDate || captured.revision !== state().revision) { render(state()); return }
    if (state().kind === 'account') void run((account) => account.reorderTasks(captured.date, ids, captured.revision))
    else changeTasks(reorderTasksByIds(tasks(), ids))
  }, onDragEnd() { dragging = false; dragContext = null },
})
renderStaticIcons()
void runtime.session.start()
