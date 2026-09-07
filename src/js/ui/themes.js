const THEME_STORAGE_KEY = 'taskly.theme.v1'
const DEFAULT_THEME_ID = 'plum'

export const themes = [
  {
    id: 'plum',
    name: 'Plum',
    swatches: ['#66506b', '#a98fa8', '#fbf4e8'],
  },
  {
    id: 'forest',
    name: 'Forest',
    swatches: ['#314636', '#8fa184', '#fbf6e8'],
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatches: ['#2f4a5f', '#8da2ad', '#f2f7f3'],
  },
  {
    id: 'rose',
    name: 'Rose',
    swatches: ['#8d5364', '#d1a5ae', '#fff1ed'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    swatches: ['#211923', '#8b6f91', '#e8e4eb'],
  },
]

export function applySavedTheme() {
  applyTheme(loadThemeId())
}

export function applyTheme(themeId) {
  const nextThemeId = isKnownTheme(themeId) ? themeId : DEFAULT_THEME_ID

  document.documentElement.dataset.theme = nextThemeId

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextThemeId)
  } catch {
    return
  }
}

export function loadThemeId() {
  try {
    const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY)

    return isKnownTheme(storedThemeId) ? storedThemeId : DEFAULT_THEME_ID
  } catch {
    return DEFAULT_THEME_ID
  }
}

function isKnownTheme(themeId) {
  return themes.some((theme) => theme.id === themeId)
}
