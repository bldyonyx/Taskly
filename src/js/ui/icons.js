import {
  Circle,
  CircleCheck,
  Trash2,
  createElement,
  createIcons,
  icons,
} from 'lucide'

export function renderStaticIcons() {
  createIcons({
    icons,
    attrs: {
      width: 18,
      height: 18,
      'stroke-width': 2.4,
    },
  })
}

export function makeIcon(iconNode, className = 'lucide-icon') {
  const icon = createElement(iconNode, {
    class: className,
    width: 18,
    height: 18,
    'stroke-width': 2.5,
    'aria-hidden': 'true',
  })

  icon.setAttribute('focusable', 'false')

  return icon
}

export function getTaskStateIcon(completed) {
  return makeIcon(completed ? CircleCheck : Circle, 'task-state-icon')
}

export function getTrashIcon() {
  return makeIcon(Trash2, 'task-delete-icon')
}
