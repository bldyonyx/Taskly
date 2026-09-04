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
import { loadTasks, saveTasks } from './js/storage/storage.js'
import {
  createSavedList,
  loadCurrentListId,
  loadSavedLists,
  saveCurrentListId,
  saveSavedLists,
  updateSavedList,
} from './js/lists/savedLists.js'
import { createTaskSorter } from './js/sortable/sortable.js'
import {
  completeAllTasks,
  completeTask,
  createTask,
  defaultTasks,
  deleteAllTasks,
  removeTaskById,
  reorderTasksByIds,
  uncheckAllTasks,
} from './js/tasks/taskManager.js'
import { renderTasks } from './js/tasks/taskRenderer.js'
import { renderDate } from './js/utils/date.js'
import { tasksSnapshot } from './js/utils/helpers.js'
import { getTaskStateIcon, getTrashIcon, renderStaticIcons } from './js/ui/icons.js'
import {
  openSavedListsDialog,
  openSaveListDialog,
  openDeleteAllTasksDialog,
  openSettingsPanel,
  renderCurrentListLabel,
} from './js/ui/modals.js'

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
  weekday: document.querySelector('#date-weekday'),
  day: document.querySelector('#date-day'),
  month: document.querySelector('#date-month'),
}

let tasks = loadTasks(defaultTasks)
let savedLists = loadSavedLists()
let currentListId = loadCurrentListId()
let isFinishingDay = false
let isDeletingAllTasks = false
let isDraggingTask = false
let didDragTask = false

if (!savedLists.some((list) => list.id === currentListId)) {
  currentListId = null
  saveCurrentListId(null)
}

function sync(animation = {}) {
  renderTasks(tasks, elements, {
    canToggle: canToggleTask,
    onToggle: toggleTask,
    onRemove: removeTask,
  }, {
    getTaskStateIcon,
    getTrashIcon,
  })
  renderProgress(tasks, elements)
  renderCurrentListLabel(elements.currentListLabel, getCurrentList(), hasUnsavedChanges())
  saveTasks(tasks)

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
  if (isDeletingAllTasks) {
    return
  }

  tasks = removeTaskById(tasks, taskId)
  sync()
}

function reorderTasks(orderedTaskIds) {
  if (isDeletingAllTasks) {
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
  saveTasks(tasks)
}

function uncheckAll() {
  if (isDeletingAllTasks) {
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

function finishDay() {
  if (isFinishingDay || isDeletingAllTasks) {
    return
  }

  const incompleteTaskIds = tasks.filter((task) => !task.completed).map((task) => task.id)

  animateFinishButton(elements.finishButton)

  if (incompleteTaskIds.length === 0 || prefersReducedMotion()) {
    tasks = completeAllTasks(tasks)
    sync()
    return
  }

  isFinishingDay = true
  elements.finishButton.disabled = true

  incompleteTaskIds.forEach((taskId, index) => {
    window.setTimeout(() => {
      tasks = completeTask(tasks, taskId, true)
      sync({ toggledTaskId: taskId, completed: true })

      if (index === incompleteTaskIds.length - 1) {
        isFinishingDay = false
        elements.finishButton.disabled = false
      }
    }, index * 90)
  })
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

function updateSavedListById(listId) {
  const savedList = savedLists.find((list) => list.id === listId)

  if (!savedList) {
    return
  }

  savedLists = savedLists.map((list) =>
    list.id === listId ? updateSavedList(list, tasks, list.name) : list,
  )
  currentListId = listId
  persistSavedLists()
  pulseSaveButton('Updated')
  sync()
}

function loadSavedList(listId) {
  const savedList = savedLists.find((list) => list.id === listId)

  if (!savedList) {
    return
  }

  tasks = savedList.tasks.map((task) => ({ ...task }))
  currentListId = savedList.id
  saveCurrentListId(currentListId)
  sync()
}

function deleteSavedList(listId) {
  savedLists = savedLists.filter((list) => list.id !== listId)

  if (currentListId === listId) {
    currentListId = null
    saveCurrentListId(null)
  }

  persistSavedLists()
  sync()
}

function persistSavedLists() {
  saveSavedLists(savedLists)
  saveCurrentListId(currentListId)
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
elements.finishButton.addEventListener('click', finishDay)
elements.settingsButton.addEventListener('click', openSettingsPanel)
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
    currentListId,
    onLoad: loadSavedList,
    onDelete: deleteSavedList,
    onUpdate: updateSavedListById,
  })
})

renderStaticIcons()
renderDate(elements)
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
