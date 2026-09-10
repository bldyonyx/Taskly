export function renderDate(elements, date = new Date()) {
  elements.weekday.textContent = date.toLocaleDateString(undefined, { weekday: 'long' })
  elements.day.textContent = date.toLocaleDateString(undefined, { day: 'numeric' })
  elements.month.textContent = date.toLocaleDateString(undefined, { month: 'long' })
}

export function getDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)

  return new Date(year, month - 1, day)
}

export function getMonthLabel(date) {
  return date.toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function getAccessibleDateLabel(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
