import Sortable from 'sortablejs'
import { prefersReducedMotion } from '../animations/animations.js'

export function createTaskSorter(listElement, { onReorder, onDragStart, onDragEnd }) {
  if (!listElement) {
    return null
  }

  const sorter = Sortable.create(listElement, {
    animation: prefersReducedMotion() ? 0 : 160,
    direction: 'vertical',
    draggable: '.task-item',
    easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    filter: '.task-actions, .task-edit-input',
    forceFallback: true,
    ghostClass: 'task-drag-ghost',
    chosenClass: 'task-drag-chosen',
    dragClass: 'task-dragging',
    fallbackClass: 'task-drag-fallback',
    fallbackOnBody: true,
    fallbackTolerance: 6,
    delay: 120,
    delayOnTouchOnly: true,
    preventOnFilter: false,
    supportPointer: false,
    touchStartThreshold: 4,
    onStart() {
      listElement.classList.add('is-sorting')
      onDragStart?.()
    },
    onEnd() {
      const orderedTaskIds = [...listElement.querySelectorAll('.task-item')]
        .map((item) => item.dataset.taskId)
        .filter(Boolean)

      listElement.classList.remove('is-sorting')
      onReorder?.(orderedTaskIds)
      onDragEnd?.()
    },
  })

  listElement.dataset.sortableReady = 'true'

  return sorter
}
