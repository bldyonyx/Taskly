export function renderDate(elements, date = new Date()) {
  elements.weekday.textContent = date.toLocaleDateString(undefined, { weekday: 'long' })
  elements.day.textContent = date.toLocaleDateString(undefined, { day: 'numeric' })
  elements.month.textContent = date.toLocaleDateString(undefined, { month: 'long' })
}
