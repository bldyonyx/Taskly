// Shared transaction core: no credentials, SDK initialization or network routing.
import { Timestamp } from 'firebase-admin/firestore'
import { validateDocument } from '../../src/js/firestore/schema.js'
import { parseCommand, requireThat, planCommand, verifyState, documentsFor, hash } from './commands.mjs'

export function createMutationCore({ db, assertRuntime, maxDocuments = 350, now = Date.now }) {
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 350) throw new Error('Invalid document cap.')
  return async function executeVerified(verifiedUid, input) {
    assertRuntime()
    const command = parseCommand(structuredClone(input))
    const uid = verifiedUid // Supplied only by the authenticated adapter.
    const root = db.doc(`users/${uid}`)
    const ref = (path) => root.collection(path.split('/')[0]).doc(path.split('/').slice(1).join('/'))
    const result = await db.runTransaction(async (tx) => {
      assertRuntime()
      const [admission, marker, receipt, manifestDoc] = await tx.getAll(db.doc(`stagingTesters/${uid}`),
        ref('trusted/state'), ref(`mutationReceipts/${command.requestId}`), ref('lifecycle/state'))
      const roster = admission.data()
      requireThat(roster?.enabled === true && roster.expiresAt instanceof Timestamp
        && roster.expiresAt.toMillis() > now()
        && roster.expiresAt.toMillis() <= now() + 3600000, 'forbidden', 'Tester is not currently admitted.')
      const control = marker.data()
      requireThat(control?.version === 1 && Number.isSafeInteger(control.requestCount)
        && control.requestCount >= 0, 'uninitialized', 'Operator-audited fresh account required; adoption is disabled.')
      const fingerprint = hash(command)
      if (receipt.exists) {
        requireThat(receipt.data().fingerprint === fingerprint, 'idempotency-conflict', 'Request ID was used for a different command.')
        return { ...receipt.data().result, replayed: true }
      }
      requireThat(control.requestCount < 1000, 'limit', 'Local receipt capacity reached; no unsafe eviction.')
      const manifest = manifestDoc.data()
      requireThat(manifest, 'integrity', 'Missing trusted manifest.')
      try { validateDocument(uid, 'lifecycle/state', manifest) } catch { requireThat(false, 'integrity', 'Invalid trusted manifest.') }
      requireThat(manifest.revision === command.expectedRevision, 'conflict', 'Stale manifest revision; reload.')
      requireThat(manifest.revision < Number.MAX_SAFE_INTEGER, 'limit', 'Revision exhausted.')
      // Bounded physical queries catch unindexed parents/children under present
      // parents. Absent-parent orphans require the operator inventory; no client
      // confirmation is ever accepted as proof of an empty account.
      const state = Object.create(null)
      let physical = 1
      for (const collection of ['days', 'savedLists', 'finishedDays']) {
        const parents = await tx.get(root.collection(collection).limit(maxDocuments + 1 - physical))
        physical += parents.size
        requireThat(physical <= maxDocuments, 'limit', 'Physical inventory exceeds bounds.')
        for (const parent of parents.docs) {
          const path = `${collection}/${parent.id}`
          const children = await tx.get(parent.ref.collection('tasks').limit(maxDocuments + 1 - physical))
          physical += children.size
          requireThat(physical <= maxDocuments, 'limit', 'Physical inventory exceeds bounds.')
          const ids = manifest.parents[path]
          requireThat(Array.isArray(ids) && ids.length === children.size
            && children.docs.every((d) => ids.includes(d.id)), 'integrity', 'Physical membership differs from manifest.')
          const byId = new Map(children.docs.map((d) => [d.id, d.data()]))
          try {
            for (const id of ids) validateDocument(uid, `${path}/tasks/${id}`, byId.get(id))
          } catch { requireThat(false, 'integrity', 'Physical task ID or owner differs from its path.') }
          state[path] = { metadata: parent.data(), tasks: ids.map((id) => byId.get(id)) }
        }
      }
      requireThat(Object.keys(state).length === Object.keys(manifest.parents).length, 'integrity', 'Missing indexed parent.')
      try { verifyState(uid, state) } catch { requireThat(false, 'integrity', 'Invalid physical state.') }
      const nextState = planCommand(uid, state, command, new Date(now()).toISOString())
      const before = documentsFor(uid, manifest.revision, state)
      const next = documentsFor(uid, manifest.revision + 1, nextState)
      requireThat(Object.keys(next).length <= maxDocuments, 'limit', 'Pilot aggregate document limit exceeded.')
      const paths = new Set([...Object.keys(before), ...Object.keys(next)])
      requireThat(paths.size + 3 <= 400, 'limit', 'Old/new paths plus service documents exceed transaction budget.')
      const committed = { ok: true, code: 'success', confirmed: true, revision: manifest.revision + 1,
        stateHash: hash(next), parentCount: Object.keys(nextState).length,
        taskCount: Object.values(nextState).reduce((n, v) => n + v.tasks.length, 0) }
      // All validation and reads complete before the first staged write.
      for (const path of paths) {
        if (!Object.hasOwn(next, path)) tx.delete(ref(path))
        else if (JSON.stringify(before[path]) !== JSON.stringify(next[path])) tx.set(ref(path), next[path])
      }
      tx.update(ref('trusted/state'), { requestCount: control.requestCount + 1 })
      tx.create(ref(`mutationReceipts/${command.requestId}`), { fingerprint, result: committed })
      return { ...committed, replayed: false }
    }, { maxAttempts: 3 })
    return result
  }
}
