import { loadTasksByDate, loadCurrentListIdsByDate, saveTasksByDate, saveCurrentListIdsByDate } from './storage.js'
import { loadSavedLists, loadCurrentListId, saveSavedLists, saveCurrentListId } from '../lists/savedLists.js'
import { loadFinishedDays, saveFinishedDays } from '../lists/finishedDays.js'

const THEME_STORAGE_KEY = 'taskly.theme.v1'

// Resolve storage lazily: importing UI modules must not access storage before
// Phase 1 recovery. No cached write baseline can become stale after an import.
export function createLocalRepository(getStorage = () => localStorage) {
  const storage = {
    getItem: (key) => getStorage().getItem(key),
    setItem(key, value) {
      const target = getStorage()
      if (target.getItem(key) !== value) target.setItem(key, value)
    },
    removeItem(key) {
      const target = getStorage()
      if (target.getItem(key) !== null) target.removeItem(key)
    },
  }

  return {
    loadState(todayKey, fallbackTasks = []) {
      const savedLists = loadSavedLists(storage)
      const savedListIds = new Set(savedLists.map((list) => list.id))
      const references = loadCurrentListIdsByDate(todayKey, loadCurrentListId(storage), storage)
      return {
        tasksByDate: loadTasksByDate(todayKey, fallbackTasks, storage),
        savedLists,
        finishedDays: loadFinishedDays(storage),
        // Ignore dangling references in memory without rewriting stored data.
        currentListIdsByDate: Object.fromEntries(
          Object.entries(references).filter(([, id]) => savedListIds.has(id)),
        ),
      }
    },
    saveTasksByDate: (tasksByDate) => saveTasksByDate(tasksByDate, storage),
    saveSavedLists: (lists) => saveSavedLists(lists, storage),
    saveFinishedDays: (days) => saveFinishedDays(days, storage),
    saveCurrentListIdsByDate(todayKey, references) {
      saveCurrentListIdsByDate(references, storage)
      saveCurrentListId(references[todayKey] ?? null, storage)
    },
    loadTheme: () => storage.getItem(THEME_STORAGE_KEY),
    saveTheme: (themeId) => storage.setItem(THEME_STORAGE_KEY, themeId),
  }
}

export const localRepository = createLocalRepository()
