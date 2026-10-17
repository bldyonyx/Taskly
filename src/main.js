import './styles/themes.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/components.css'
import './styles/animations.css'
import {
  animateAllTasksDelete,
  animateFinishButton,
  animateTaskChecked,
  animateTaskEnter,
  animateTaskUnchecked,
  prefersReducedMotion,
} from './js/animations/animations.js'
import { renderProgress } from './js/ui/progress.js'
import { localRepository as repository } from './js/storage/repository.js'
import {
  createActiveTasksFromSavedList,
  createSavedList,
  updateSavedList,
} from './js/lists/savedLists.js'
import {
  createActiveTasksFromFinishedDay,
  createFinishedDay,
  createFinishedDayTaskSnapshot,
  findFinishedDayByDateKey,
  getFinishedDayDateKeys,
  updateFinishedDay,
} from './js/lists/finishedDays.js'
import { createTaskSorter } from './js/sortable/sortable.js'
import {
  completeTask,
  createTask,
  defaultTasks,
  deleteAllTasks,
  removeTaskById,
  reorderTasksByIds,
  uncheckAllTasks,
  updateTaskText,
} from './js/tasks/taskManager.js'
import { renderTasks } from './js/tasks/taskRenderer.js'
import { tasksSnapshot } from './js/utils/helpers.js'
import { getEditIcon, getTaskStateIcon, getTrashIcon, renderStaticIcons } from './js/ui/icons.js'
import {
  openSavedListsDialog,
  openSaveListDialog,
  openDeleteAllTasksDialog,
  openCalendarDialog,
  openFinishDayDialog,
  openSettingsPanel,
  renderCurrentListLabel,
} from './js/ui/modals.js'
import { applySavedTheme } from './js/ui/themes.js'
import { getAccessibleDateLabel, getDateKey, parseDateKey, renderDate } from './js/utils/date.js'
import { prepareLocalData } from './js/ui/backupControls.js'
import { authSession } from './js/auth/index.js'

if (!prepareLocalData()) throw new Error('Taskly startup paused for data recovery.')
applySavedTheme()

const elements = {
  form: document.querySelector('#task-form'),
  input: document.querySelector('#new-task'),
  list: document.querySelector('#task-list'),
  empty: document.querySelector('#empty-state'),
  saveButton: document.querySelector('#save-list'),
  savedListsButton: document.querySelector('#saved-lists'),
  uncheckButton: document.querySelector('#uncheck-all'),
  deleteAllButton: document.querySelector('#delete-all'),
  finishButton: document.querySelector('#finish-day'),
  currentListLabel: document.querySelector('#current-list-label'),
  count: document.querySelector('#task-count'),
  fill: document.querySelector('#progress-fill'),
  track: document.querySelector('.progress-track'),
  settingsButton: document.querySelector('.settings-button'),
  dateCard: document.querySelector('#date-card'),
  weekday: document.querySelector('#date-weekday'),
  day: document.querySelector('#date-day'),
  month: document.querySelector('#date-month'),
}

const todayKey = getDateKey()
let selectedDateKey = todayKey
let selectedDate = parseDateKey(selectedDateKey)
let { tasksByDate, savedLists, finishedDays, currentListIdsByDate } = repository.loadState(todayKey, defaultTasks)
let selectedFinishedDayId = getFinishedDayForDateKey(selectedDateKey)?.id ?? null
let tasks = getTasksForSelectedDate()
let currentListId = selectedFinishedDayId ? null : currentListIdsByDate[selectedDateKey] ?? null
let isFinishingDay = false
let isDeletingAllTasks = false
let isDraggingTask = false
let didDragTask = false

void authSession.start()

function render(animation = {}) {
  renderTasks(tasks, elements, {
    canToggle: canToggleTask,
    onToggle: toggleTask,
    onRemove: removeTask,
    onEdit: editTask,
  }, {
    getEditIcon,
    getTaskStateIcon,
    getTrashIcon,
  })
  renderProgress(tasks, elements)
  renderCurrentListLabel(elements.currentListLabel, getCurrentList(), hasUnsavedChanges())

  if (animation.addedTaskId) {
    animateTaskEnter(getTaskElement(animation.addedTaskId))
  }

  if (animation.toggledTaskId) {
    const item = getTaskElement(animation.toggledTaskId)

    if (animation.completed) {
      animateTaskChecked(item)
    } else {
      animateTaskUnchecked(item)
    }
  }
}

function addTask(text) {
  if (isFinishingDay) {
    return
  }

  const nextTask = createTask(text)

  if (nextTask.text.length === 0) {
    return
  }

  tasks = [nextTask, ...tasks]
  persistSelectedDateTasks()
  render({ addedTaskId: nextTask.id })
}

function toggleTask(taskId) {
  if (isFinishingDay || isDeletingAllTasks || !canToggleTask()) {
    return
  }

  const nextCompleted = !tasks.find((task) => task.id === taskId)?.completed

  tasks = completeTask(tasks, taskId, nextCompleted)
  persistSelectedDateTasks()
  render({ toggledTaskId: taskId, completed: nextCompleted })
}

function removeTask(taskId) {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  tasks = removeTaskById(tasks, taskId)
  persistSelectedDateTasks()
  render()
}

function editTask(taskId, text) {
  if (isFinishingDay || isDeletingAllTasks) {
    return false
  }

  const trimmedText = text.trim()

  if (trimmedText.length === 0) {
    return false
  }

  tasks = updateTaskText(tasks, taskId, trimmedText)
  persistSelectedDateTasks()
  render()
  return true
}

function reorderTasks(orderedTaskIds) {
  if (isFinishingDay || isDeletingAllTasks) {
    render()
    return
  }

  const reorderedTasks = reorderTasksByIds(tasks, orderedTaskIds)

  if (reorderedTasks === tasks) {
    render()
    return
  }

  tasks = reorderedTasks
  renderCurrentListLabel(elements.currentListLabel, getCurrentList(), hasUnsavedChanges())
  persistSelectedDateTasks()
}

function uncheckAll() {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  tasks = uncheckAllTasks(tasks)
  persistSelectedDateTasks()
  render()
}

function requestDeleteAllTasks() {
  if (isDeletingAllTasks) {
    return
  }

  openDeleteAllTasksDialog({
    onConfirm: deleteAllTasksWithAnimation,
  })
}

function deleteAllTasksWithAnimation() {
  if (isDeletingAllTasks) {
    return
  }

  isDeletingAllTasks = true
  elements.uncheckButton.disabled = true
  elements.deleteAllButton.disabled = true

  animateAllTasksDelete(elements.list.querySelectorAll('.task-item'), () => {
    tasks = deleteAllTasks()
    persistSelectedDateTasks()
    isDeletingAllTasks = false
    elements.uncheckButton.disabled = false
    elements.deleteAllButton.disabled = false
    render()
  })
}

function requestFinishDay() {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  if (selectedFinishedDayId) {
    return
  }

  if (tasks.length === 0) {
    return
  }

  isFinishingDay = true
  elements.finishButton.disabled = true

  openFinishDayDialog({
    dateLabel: getAccessibleDateLabel(selectedDate),
    onCancel: finishDayCleanup,
    onConfirm: finishDay,
  })
}

function finishDay() {
  if (tasks.length === 0) {
    finishDayCleanup()
    return
  }

  finishedDays = [createFinishedDay(tasks, selectedDate), ...finishedDays]
  repository.saveFinishedDays(finishedDays)
  // Persist the final result once. The completion animation below is visual
  // state only and must not save its temporary all-completed task snapshots.
  tasksByDate = { ...tasksByDate, [selectedDateKey]: [] }
  currentListIdsByDate = { ...currentListIdsByDate }
  delete currentListIdsByDate[selectedDateKey]
  repository.saveTasksByDate(tasksByDate)
  repository.saveCurrentListIdsByDate(todayKey, currentListIdsByDate)

  animateFinishButton(elements.finishButton)

  if (prefersReducedMotion()) {
    resetCurrentDay()
    render()
    finishDayCleanup()
    return
  }

  const taskIds = tasks.map((task) => task.id)

  taskIds.forEach((taskId, index) => {
    window.setTimeout(() => {
      tasks = completeTask(tasks, taskId, true)
      render({ toggledTaskId: taskId, completed: true })

      if (index === taskIds.length - 1) {
        window.setTimeout(() => {
          resetCurrentDay()
          render()
          finishDayCleanup()
        }, 120)
      }
    }, index * 90)
  })
}

function resetCurrentDay() {
  tasks = deleteAllTasks()
  currentListId = null
}

function finishDayCleanup() {
  isFinishingDay = false
  elements.finishButton.disabled = false
}

function getTaskElement(taskId) {
  return elements.list.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)
}

function canToggleTask() {
  return !isDraggingTask && !didDragTask
}

function getCurrentList() {
  return savedLists.find((list) => list.id === currentListId) ?? null
}

function hasUnsavedChanges() {
  const currentList = getCurrentList()

  return currentList ? tasksSnapshot(tasks) !== tasksSnapshot(currentList.tasks) : false
}

function saveNewList(name) {
  const savedList = createSavedList(name, tasks)
  savedLists = [savedList, ...savedLists]
  currentListId = savedList.id
  persistSavedLists()
  persistSelectedDateTasks()
  pulseSaveButton('Saved')
  render()
}

function updateCurrentList(name = getCurrentList()?.name) {
  const currentList = getCurrentList()

  if (!currentList || !name) {
    return
  }

  savedLists = savedLists.map((list) =>
    list.id === currentList.id ? updateSavedList(list, tasks, name) : list,
  )
  persistSavedLists()
  persistSelectedDateTasks()
  pulseSaveButton('Updated')
  render()
}

function editSavedListById(listId, editedTasks, name) {
  const savedList = savedLists.find((list) => list.id === listId)

  if (!savedList) {
    return
  }

  savedLists = savedLists.map((list) =>
    list.id === listId ? updateSavedList(list, editedTasks, name) : list,
  )
  persistSavedLists()
  pulseSaveButton('Updated')
  render()
}

function loadSavedList(listId, mode = 'replace') {
  const savedList = savedLists.find((list) => list.id === listId)

  if (!savedList) {
    return
  }

  const loadedTasks = createActiveTasksFromSavedList(savedList)
  tasks = mode === 'append' ? [...tasks, ...loadedTasks] : loadedTasks
  currentListId = savedList.id
  saveCurrentListForSelectedDate(currentListId)
  persistSelectedDateTasks()
  render()
}

function loadFinishedDay(finishedDayId, mode = 'replace') {
  const finishedDay = finishedDays.find((day) => day.id === finishedDayId)

  if (!finishedDay) {
    return
  }

  const loadedTasks = createActiveTasksFromFinishedDay(finishedDay)
  tasks = mode === 'append' ? [...tasks, ...loadedTasks] : loadedTasks
  currentListId = null
  saveCurrentListForSelectedDate(null)
  persistSelectedDateTasks()
  render()
}

function editFinishedDayById(finishedDayId, editedTasks) {
  const finishedDay = finishedDays.find((day) => day.id === finishedDayId)

  if (!finishedDay) {
    return
  }

  finishedDays = finishedDays.map((day) =>
    day.id === finishedDayId ? updateFinishedDay(day, editedTasks) : day,
  )
  repository.saveFinishedDays(finishedDays)

  if (selectedFinishedDayId === finishedDayId) {
    tasks = createFinishedDayTaskSnapshot(editedTasks)
    render()
  }
}

function deleteSavedList(listId) {
  savedLists = savedLists.filter((list) => list.id !== listId)
  currentListIdsByDate = Object.fromEntries(
    Object.entries(currentListIdsByDate).filter(([, savedListId]) => savedListId !== listId),
  )

  if (currentListId === listId) {
    currentListId = null
    saveCurrentListForSelectedDate(null)
  }

  persistSavedLists()
  render()
}

function persistSavedLists() {
  repository.saveSavedLists(savedLists)
  saveCurrentListForSelectedDate(currentListId)
}

function persistSelectedDateTasks() {
  if (selectedFinishedDayId) {
    finishedDays = finishedDays.map((day) =>
      day.id === selectedFinishedDayId ? updateFinishedDay(day, tasks) : day,
    )
    repository.saveFinishedDays(finishedDays)
    return
  }

  tasksByDate = {
    ...tasksByDate,
    [selectedDateKey]: tasks,
  }
  repository.saveTasksByDate(tasksByDate)
  // Pin legacy list references to their original date when a user first edits
  // tasks. Startup and navigation keep this fallback strictly in memory.
  repository.saveCurrentListIdsByDate(todayKey, currentListIdsByDate)
}

function saveCurrentListForSelectedDate(listId) {
  currentListId = listId

  if (listId) {
    currentListIdsByDate = {
      ...currentListIdsByDate,
      [selectedDateKey]: listId,
    }
  } else {
    currentListIdsByDate = { ...currentListIdsByDate }
    delete currentListIdsByDate[selectedDateKey]
  }

  repository.saveCurrentListIdsByDate(todayKey, currentListIdsByDate)
}

function selectDate(dateKey) {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  selectedDateKey = dateKey
  selectedDate = parseDateKey(selectedDateKey)
  selectedFinishedDayId = getFinishedDayForDateKey(selectedDateKey)?.id ?? null
  tasks = getTasksForSelectedDate()
  currentListId = selectedFinishedDayId ? null : currentListIdsByDate[selectedDateKey] ?? null
  renderSelectedDate()
  render()
}

function renderSelectedDate() {
  renderDate(elements, selectedDate)
  elements.dateCard.setAttribute('aria-label', `Open calendar, selected date ${getAccessibleDateLabel(selectedDate)}`)
}

function openCalendar() {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  openCalendarDialog({
    selectedDateKey,
    todayKey: getDateKey(),
    taskDateKeys: Object.entries(tasksByDate)
      .filter(([, dateTasks]) => Array.isArray(dateTasks) && dateTasks.length > 0)
      .map(([dateKey]) => dateKey),
    finishedDayDateKeys: getFinishedDayDateKeys(finishedDays),
    onSelect: selectDate,
  })
}

function getFinishedDayForDateKey(dateKey) {
  return findFinishedDayByDateKey(finishedDays, dateKey)
}

function getSelectedFinishedDay() {
  return selectedFinishedDayId
    ? finishedDays.find((day) => day.id === selectedFinishedDayId) ?? null
    : null
}

function getTasksForSelectedDate() {
  const finishedDay = getSelectedFinishedDay() ?? getFinishedDayForDateKey(selectedDateKey)

  if (finishedDay) {
    return createFinishedDayTaskSnapshot(finishedDay.tasks)
  }

  return tasksByDate[selectedDateKey] ?? []
}

function pulseSaveButton(label) {
  const labelElement = elements.saveButton.querySelector('span')

  elements.saveButton.classList.add('is-saved')
  labelElement.textContent = label

  window.setTimeout(() => {
    elements.saveButton.classList.remove('is-saved')
    labelElement.textContent = 'Save list'
  }, 1100)
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault()
  addTask(elements.input.value)
  elements.input.value = ''
  elements.input.focus()
})

elements.uncheckButton.addEventListener('click', uncheckAll)
elements.deleteAllButton.addEventListener('click', requestDeleteAllTasks)
elements.finishButton.addEventListener('click', requestFinishDay)
elements.settingsButton.addEventListener('click', () => {
  if (!isFinishingDay && !isDeletingAllTasks && !isDraggingTask) openSettingsPanel()
})
elements.dateCard.addEventListener('click', openCalendar)
elements.dateCard.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openCalendar()
  }
})
elements.saveButton.addEventListener('click', () => {
  openSaveListDialog({
    currentList: getCurrentList(),
    onSaveNew: saveNewList,
    onUpdateCurrent: updateCurrentList,
  })
})
elements.savedListsButton.addEventListener('click', () => {
  openSavedListsDialog({
    lists: savedLists,
    finishedDays,
    currentListId,
    hasCurrentTasks: tasks.length > 0,
    onLoad: loadSavedList,
    onDelete: deleteSavedList,
    onEdit: editSavedListById,
    onDeleteFinishedDay(finishedDayId) {
      finishedDays = finishedDays.filter((day) => day.id !== finishedDayId)
      repository.saveFinishedDays(finishedDays)

      if (selectedFinishedDayId === finishedDayId) {
        selectedFinishedDayId = null
        tasks = tasksByDate[selectedDateKey] ?? []
        currentListId = currentListIdsByDate[selectedDateKey] ?? null
        render()
      }
    },
    onLoadFinishedDay: loadFinishedDay,
    onEditFinishedDay: editFinishedDayById,
  })
})

renderStaticIcons()
renderSelectedDate()
render()

createTaskSorter(elements.list, {
  onDragStart() {
    isDraggingTask = true
    didDragTask = true
  },
  onDragEnd() {
    isDraggingTask = false
    window.setTimeout(() => {
      didDragTask = false
    }, 0)
  },
  onReorder: reorderTasks,
})
