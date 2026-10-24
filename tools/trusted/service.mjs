import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Firestore, Timestamp } from 'firebase-admin/firestore'
import { validId, validateDocument } from '../../src/js/firestore/schema.js'
import { assertEmulators, prepareLocalRuntime, PROJECT, FIRESTORE_HOST } from './config.mjs'
import { parseCommand, requireThat, planCommand, verifyState, documentsFor, hash } from './commands.mjs'

export function createTrustedService() {
  prepareLocalRuntime()
  // Explicit inert credential: never invoke applicationDefault or metadata servers.
  const app = initializeApp({ projectId: PROJECT, credential: {
    getAccessToken: async () => ({ access_token: 'owner', expires_in: 3600 }),
  } }, `trusted-${randomUUID()}`)
  // The server Firestore constructor is exported by Admin. Its explicit insecure
  // emulator channel uses Bearer owner without ADC or a real certificate.
  const db = new Firestore({ projectId: PROJECT, host: FIRESTORE_HOST, ssl: false })
  const auth = getAuth(app)
  return {
    async execute(idToken, input) {
      try {
        assertEmulators()
        requireThat(typeof idToken === 'string' && idToken.length > 0 && idToken.length <= 16384, 'unauthenticated', 'Emulator ID token required.')
        let identity
        try {
          identity = await auth.verifyIdToken(idToken, true)
          // Emulator JWT verification tolerates absent temporal claims. Require
          // them explicitly so missing auth_time cannot skip revocation checks.
          const now = Math.floor(Date.now() / 1000)
          requireThat(Number.isSafeInteger(identity.exp) && identity.exp > now
            && Number.isSafeInteger(identity.iat) && identity.iat >= 0 && identity.iat <= now + 60
            && Number.isSafeInteger(identity.auth_time) && identity.auth_time >= 0
            && identity.auth_time <= now + 60, 'unauthenticated', 'Invalid emulator token times.')
          const user = await auth.getUser(identity.uid)
          requireThat(!user.disabled && validId(identity.uid), 'unauthenticated', 'Invalid emulator user.')
        } catch { requireThat(false, 'unauthenticated', 'Invalid, expired, revoked or unknown emulator identity.') }
        const command = parseCommand(structuredClone(input))
        const uid = identity.uid // No request UID, path, owner or service claim is accepted.
        const root = db.doc(`users/${uid}`)
        const ref = (path) => root.collection(path.split('/')[0]).doc(path.split('/').slice(1).join('/'))
        const result = await db.runTransaction(async (tx) => {
          assertEmulators()
          const [admission, marker, receipt, manifestDoc] = await tx.getAll(db.doc(`stagingTesters/${uid}`),
            ref('trusted/state'), ref(`mutationReceipts/${command.requestId}`), ref('lifecycle/state'))
          const roster = admission.data()
          requireThat(roster?.enabled === true && roster.expiresAt instanceof Timestamp
            && roster.expiresAt.toMillis() > Date.now(), 'forbidden', 'Tester is not currently admitted.')
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
            const parents = await tx.get(root.collection(collection).limit(351 - physical))
            physical += parents.size
            requireThat(physical <= 350, 'limit', 'Physical inventory exceeds bounds.')
            for (const parent of parents.docs) {
              const path = `${collection}/${parent.id}`
              const children = await tx.get(parent.ref.collection('tasks').limit(351 - physical))
              physical += children.size
              requireThat(physical <= 350, 'limit', 'Physical inventory exceeds bounds.')
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
          const nextState = planCommand(uid, state, command, new Date().toISOString())
          const before = documentsFor(uid, manifest.revision, state)
          const next = documentsFor(uid, manifest.revision + 1, nextState)
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
        })
        return result // runTransaction resolved: result describes the committed attempt.
      } catch (error) {
        return { ok: false, code: error.trustedCode ?? 'unavailable', confirmed: false,
          message: error.trustedCode ? error.message : 'Mutation could not be confirmed; retry the same request ID.' }
      }
    },
    close: async () => { await db.terminate(); await deleteApp(app) },
  }
}
