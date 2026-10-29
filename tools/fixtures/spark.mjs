import { mapLocalStateToDocuments, validateDocument } from '../../src/js/firestore/schema.js'
import { pathToFileURL } from 'node:url'
// Pure deterministic local output. No SDK, credentials, storage or upload capability.
export function sparkFixture(uid = 'synthetic-alice') {
  const documents = mapLocalStateToDocuments({
    tasksByDate: { '2026-10-29': [{ id: 'synthetic-task', text: 'Review synthetic example', completed: false }] },
    currentListIdsByDate: {}, savedLists: [], finishedDays: [],
  }, { uid, themeId: 'plum', finishedDayDateKeys: {} })
  documents.push({ path: 'lifecycle/state', data: { schemaVersion: 1, ownerId: uid, revision: 0,
    parents: { 'days/2026-10-29': ['synthetic-task'] } } })
  for (const { path, data } of documents) validateDocument(uid, path, data)
  if (documents.length > 50) throw new Error('Fixture cap exceeded.')
  return { uid, documents }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(sparkFixture(), null, 2))
