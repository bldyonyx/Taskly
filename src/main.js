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
import {
  loadCurrentListIdsByDate,
  loadTasksByDate,
  saveCurrentListIdsByDate,
  saveTasksByDate,
} from './js/storage/storage.js'
import {
  createActiveTasksFromSavedList,
  createSavedList,
  loadCurrentListId,
  loadSavedLists,
  saveCurrentListId,
  saveSavedLists,
  updateSavedList,
} from './js/lists/savedLists.js'
import {
  createActiveTasksFromFinishedDay,
  createFinishedDay,
  loadFinishedDays,
  saveFinishedDays,
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
let tasksByDate = loadTasksByDate(todayKey, defaultTasks)
let savedLists = loadSavedLists()
let finishedDays = loadFinishedDays()
let currentListIdsByDate = loadCurrentListIdsByDate(todayKey, loadCurrentListId())
let tasks = tasksByDate[selectedDateKey] ?? []
let currentListId = currentListIdsByDate[selectedDateKey] ?? null
let isFinishingDay = false
let isDeletingAllTasks = false
let isDraggingTask = false
let didDragTask = false

if (!savedLists.some((list) => list.id === currentListId)) {
  currentListId = null
  saveCurrentListForSelectedDate(null)
}
pruneCurrentListIdsByDate()

function sync(animation = {}) {
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
  persistSelectedDateTasks()

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
  sync({ addedTaskId: nextTask.id })
}

function toggleTask(taskId) {
  if (isFinishingDay || isDeletingAllTasks || !canToggleTask()) {
    return
  }

  const nextCompleted = !tasks.find((task) => task.id === taskId)?.completed

  tasks = completeTask(tasks, taskId, nextCompleted)
  sync({ toggledTaskId: taskId, completed: nextCompleted })
}

function removeTask(taskId) {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  tasks = removeTaskById(tasks, taskId)
  sync()
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
  sync()
  return true
}

function reorderTasks(orderedTaskIds) {
  if (isFinishingDay || isDeletingAllTasks) {
    sync()
    return
  }

  const reorderedTasks = reorderTasksByIds(tasks, orderedTaskIds)

  if (reorderedTasks === tasks) {
    sync()
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
  sync()
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
    isDeletingAllTasks = false
    elements.uncheckButton.disabled = false
    elements.deleteAllButton.disabled = false
    sync()
  })
}

function requestFinishDay() {
  if (isFinishingDay || isDeletingAllTasks) {
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
  saveFinishedDays(finishedDays)

  animateFinishButton(elements.finishButton)

  if (prefersReducedMotion()) {
    resetCurrentDay()
    sync()
    finishDayCleanup()
    return
  }

  const taskIds = tasks.map((task) => task.id)

  taskIds.forEach((taskId, index) => {
    window.setTimeout(() => {
      tasks = completeTask(tasks, taskId, true)
      sync({ toggledTaskId: taskId, completed: true })

      if (index === taskIds.length - 1) {
        window.setTimeout(() => {
          resetCurrentDay()
          sync()
          finishDayCleanup()
        }, 120)
      }
    }, index * 90)
  })
}

function resetCurrentDay() {
  tasks = deleteAllTasks()
  currentListId = null
  saveCurrentListForSelectedDate(null)
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
  pulseSaveButton('Saved')
  sync()
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
  pulseSaveButton('Updated')
  sync()
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
  sync()
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
  sync()
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
  sync()
}

function editFinishedDayById(finishedDayId, editedTasks) {
  const finishedDay = finishedDays.find((day) => day.id === finishedDayId)

  if (!finishedDay) {
    return
  }

  finishedDays = finishedDays.map((day) =>
    day.id === finishedDayId ? updateFinishedDay(day, editedTasks) : day,
  )
  saveFinishedDays(finishedDays)
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
  sync()
}

function persistSavedLists() {
  saveSavedLists(savedLists)
  saveCurrentListForSelectedDate(currentListId)
}

function persistSelectedDateTasks() {
  tasksByDate = {
    ...tasksByDate,
    [selectedDateKey]: tasks,
  }
  saveTasksByDate(tasksByDate)
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

  saveCurrentListIdsByDate(currentListIdsByDate)
  saveCurrentListId(currentListIdsByDate[todayKey] ?? null)
}

function pruneCurrentListIdsByDate() {
  const savedListIds = new Set(savedLists.map((list) => list.id))
  currentListIdsByDate = Object.fromEntries(
    Object.entries(currentListIdsByDate).filter(([, listId]) => savedListIds.has(listId)),
  )
  currentListId = currentListIdsByDate[selectedDateKey] ?? null
  saveCurrentListIdsByDate(currentListIdsByDate)
  saveCurrentListId(currentListIdsByDate[todayKey] ?? null)
}

function selectDate(dateKey) {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  persistSelectedDateTasks()
  selectedDateKey = dateKey
  selectedDate = parseDateKey(selectedDateKey)
  tasks = tasksByDate[selectedDateKey] ?? []
  currentListId = currentListIdsByDate[selectedDateKey] ?? null
  renderSelectedDate()
  sync()
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
    onSelect: selectDate,
  })
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
elements.settingsButton.addEventListener('click', openSettingsPanel)
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
      saveFinishedDays(finishedDays)
    },
    onLoadFinishedDay: loadFinishedDay,
    onEditFinishedDay: editFinishedDayById,
  })
})

renderStaticIcons()
renderSelectedDate()
sync()

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
