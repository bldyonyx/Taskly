import { mapLocalStateToDocuments } from '../../src/js/firestore/schema.js'

export function localState() {
  const tasks = [
    { id: 'task-b', text: 'First task', completed: true },
    { id: 'task-a', text: 'Second task', completed: false },
  ]
  return {
    tasksByDate: { '2026-10-18': tasks, '2026-10-19': [] },
    currentListIdsByDate: { '2026-10-18': 'list-b' },
    savedLists: [{ id: 'list-b', name: 'Tiny plans', tasks, createdAt: '2026-10-01T12:00:00Z', updatedAt: '2026-10-02T12:00:00Z' }],
    finishedDays: [{ id: 'finished-b', date: '2026-10-17T22:00:00.000Z', createdAt: '2026-10-17T22:00:00.000Z', tasks, completedCount: 1, totalCount: 2 }],
  }
}

export function documents(uid = 'alice') {
  return [...mapLocalStateToDocuments(localState(), {
    uid, themeId: 'forest', finishedDayDateKeys: { 'finished-b': '2026-10-18' },
  }), {
    path: 'imports/import-1', data: {
      schemaVersion: 1, ownerId: uid, id: 'import-1', sourceId: 'device-1', backupHash: 'a'.repeat(64),
      status: 'pending', createdAt: '2026-10-18T12:00:00Z', completedAt: null,
    },
  }]
}
