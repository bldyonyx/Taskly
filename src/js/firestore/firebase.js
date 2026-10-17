import { getAuth } from 'firebase/auth'
import { getFirestore, doc, collection, getDocFromServer, getDocsFromServer, runTransaction, onSnapshot } from 'firebase/firestore'
import { createFirestoreRepository } from './repository.js'

// Not imported by the running app. Future callers must explicitly supply the
// existing initialized Firebase App and the resolved Auth session controller.
export async function createFirebaseFirestoreRepository({ app, session }) {
  if (!app) throw new Error('An existing initialized Firebase App is required.')
  const auth = getAuth(app)
  await auth.authStateReady()
  const state = session.getState()
  const uid = state.user?.uid
  const check = () => {
    if (!uid || auth.currentUser?.uid !== uid) throw new Error('Firebase Auth does not match the requested account.')
  }
  check()
  // Database initialization is deferred until an explicit operation, not factory
  // construction. Default memory cache only; no persistent disk cache is enabled.
  const database = () => { check(); return getFirestore(app) }
  return createFirestoreRepository({ uid, session, transport: createFirestoreTransport({ database, check }) })
}

// Injectable database resolver also lets emulator tests exercise the real SDK
// adapter without initializing production Auth or touching production endpoints.
export function createFirestoreTransport({ database, check }) {
  return {
    async read(path) {
      const snapshot = await getDocFromServer(doc(database(), path))
      check()
      return snapshot.exists() ? snapshot.data() : null
    },
    async list(path) {
      const snapshot = await getDocsFromServer(collection(database(), path))
      check()
      return snapshot.docs.map((item) => ({ id: item.id, data: item.data() }))
    },
    async transact(paths, plan) {
      const db = database()
      if (paths.length === 0) throw new Error('A transaction requires at least one document.')
      // SDK transaction RPCs can bypass disableNetwork's stream state. Require
      // a server-only read through the regular client before submitting a commit.
      // This is a connectivity check, not a replacement for transaction reads.
      await getDocFromServer(doc(db, paths[0]))
      check()
      await runTransaction(db, async (transaction) => {
        check()
        const refs = paths.map((path) => doc(db, path))
        const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
        check()
        const changes = plan(snapshots.map((snapshot) => snapshot.exists() ? snapshot.data() : null))
        check()
        for (const { path, data } of changes) {
          if (data === null) transaction.delete(doc(db, path))
          else transaction.set(doc(db, path), data)
        }
      })
      check()
    },
    subscribe: (path, next, onError) => onSnapshot(collection(database(), path), { includeMetadataChanges: true }, (snapshot) => {
      try {
        check()
        // Cache and local pending mutations are never represented as server confirmation.
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
        next(snapshot.docs.map((item) => ({ id: item.id, data: item.data() })))
      } catch (error) { onError(error) }
    }, onError),
  }
}
