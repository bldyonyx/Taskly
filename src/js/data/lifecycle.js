import { validateDocument } from '../firestore/schema.js'

export const MANIFEST_PATH = 'lifecycle/state'
export function requireLifecycle(condition, code, message) {
  if (!condition) throw Object.assign(new Error(message), { code: `taskly/${code}` })
}
const pathsFor = (manifest) => [MANIFEST_PATH, ...Object.entries(manifest.parents)
  .flatMap(([parent, ids]) => [parent, ...ids.map((id) => `${parent}/tasks/${id}`)])]

// One bounded account revision serializes membership and reference changes.
export function createLifecycle(repository) {
  const full = (data) => ({ ...data, schemaVersion: 1, ownerId: repository.uid })
  function verify(aggregates) {
    for (const [parent, { metadata, tasks }] of Object.entries(aggregates)) {
      if (parent.startsWith('days/') && metadata.currentListId !== null) {
        requireLifecycle(aggregates[`savedLists/${metadata.currentListId}`], 'integrity', 'Dangling saved-list reference.')
      }
      if (parent.startsWith('finishedDays/')) {
        requireLifecycle(metadata.totalCount === tasks.length
          && metadata.completedCount === tasks.filter((task) => task.completed).length, 'integrity', 'Finished-day counts differ from snapshot.')
      }
    }
  }
  async function transact({ expectedRevision, extraPaths = [], mutate } = {}) {
    const extras = [...extraPaths]
    const index = await repository.read(MANIFEST_PATH)
    requireLifecycle(index, 'uninitialized', 'Cloud lifecycle is uninitialized; explicit empty-account initialization or reconciliation is required.')
    const revision = expectedRevision === undefined ? index.revision : expectedRevision
    requireLifecycle(Number.isSafeInteger(revision) && revision >= 0 && revision === index.revision,
      'conflict', 'Account changed; reload before retrying this operation.')
    const indexedPaths = pathsFor(index)
    const paths = [...new Set([...indexedPaths, ...extras])]
    let result
    try {
      await repository.atomic(paths, (before) => {
        requireLifecycle(before[MANIFEST_PATH]?.revision === revision, 'conflict', 'Account changed; reload before retrying this operation.')
        const aggregates = {}
        for (const [parent, ids] of Object.entries(index.parents)) {
          requireLifecycle(before[parent], 'integrity', `Missing indexed parent: ${parent}`)
          const tasks = ids.map((id, order) => {
            const data = before[`${parent}/tasks/${id}`]
            requireLifecycle(data && data.order === order, 'integrity', 'Task membership or order differs from manifest.')
            return structuredClone(data)
          })
          aggregates[parent] = { metadata: structuredClone(before[parent]), tasks }
        }
        verify(aggregates)
        if (!mutate) { result = { revision, aggregates }; return [] }
        mutate(aggregates)
        verify(aggregates)
        const next = { [MANIFEST_PATH]: full({ revision: revision + 1, parents: {} }) }
        for (const [parent, { metadata, tasks }] of Object.entries(aggregates)) {
          requireLifecycle(new Set(tasks.map((task) => task.id)).size === tasks.length, 'integrity', 'Duplicate task IDs.')
          next[MANIFEST_PATH].parents[parent] = tasks.map((task) => task.id)
          next[parent] = full(metadata)
          tasks.forEach((task, order) => {
            next[`${parent}/tasks/${task.id}`] = full({ id: task.id, text: task.text, completed: task.completed, order })
          })
        }
        validateDocument(repository.uid, MANIFEST_PATH, next[MANIFEST_PATH])
        for (const path of extras) {
          if (!indexedPaths.includes(path)) requireLifecycle(before[path] === null, 'integrity', 'Untracked cloud data requires explicit reconciliation.')
        }
        const changes = []
        for (const path of new Set([...Object.keys(before), ...Object.keys(next)])) {
          requireLifecycle(paths.includes(path), 'integrity', 'Mutation requires an undeclared document.')
          const data = next[path] ?? null
          if (JSON.stringify(before[path]) !== JSON.stringify(data)) changes.push({ path, data })
        }
        result = { revision: revision + 1 }
        return changes
      }, { cascade: true })
    } catch (error) {
      repository.assertActive()
      // With getAfter rules a competing commit can be rejected by rules before
      // the SDK retries its callback. Distinguish that from a genuine rules denial.
      if (['permission-denied', 'aborted'].includes(error.code)) {
        let latest
        try { latest = await repository.read(MANIFEST_PATH) } catch { repository.assertActive(); throw error }
        requireLifecycle(latest?.revision === revision, 'conflict', 'Account changed; reload before retrying this operation.')
      }
      throw error
    }
    repository.assertActive()
    return { confirmed: true, ...result }
  }
  return {
    full, transact,
    async initializeEmptyAccount({ confirmedEmpty = false } = {}) {
      requireLifecycle(confirmedEmpty === true, 'confirmation-required', 'Explicit confirmation of an audited empty cloud account is required.')
      const collections = await Promise.all(['days', 'savedLists', 'finishedDays'].map((path) => repository.list(path)))
      requireLifecycle(collections.every((items) => items.length === 0), 'reconciliation-required', 'Existing cloud records require explicit reconciliation.')
      return repository.atomic([MANIFEST_PATH], (before) => {
        requireLifecycle(before[MANIFEST_PATH] === null, 'conflict', 'Cloud lifecycle is already initialized.')
        return [{ path: MANIFEST_PATH, data: full({ revision: 0, parents: {} }) }]
      })
    },
  }
}
