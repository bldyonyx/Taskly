import { getAuth } from 'firebase/auth'
import { getFirestore, doc, collection, getDocFromServer, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore'
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
  return createFirestoreRepository({ uid, session, transport: {
    async read(path) {
      const snapshot = await getDocFromServer(doc(database(), path))
      check()
      return snapshot.exists() ? snapshot.data() : null
    },
    async write(path, data) { await setDoc(doc(database(), path), data); check() },
    async remove(path) { await deleteDoc(doc(database(), path)); check() },
    subscribe: (path, next, onError) => onSnapshot(collection(database(), path), (snapshot) => {
      try {
        check()
        next(snapshot.docs.map((item) => ({ id: item.id, data: item.data() })))
      } catch (error) { onError(error) }
    }, onError),
  } })
}
