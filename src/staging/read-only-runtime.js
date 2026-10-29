import { initializeApp, getApps } from 'firebase/app'
import { getAuth, setPersistence, inMemoryPersistence, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth'
import { initializeFirestore, doc, collection, getDocFromServer, getDocsFromServer, query, limit } from 'firebase/firestore'
import { assertReadOnlyActivation, createReadOnlyReader } from './read-only.js'

export async function createReadOnlyRuntime(env, location) {
  const config = assertReadOnlyActivation(env, location) // before any SDK initialization
  if (getApps().length) throw new Error('Staging requires an isolated page without another Firebase app.')
  const app = initializeApp(config, 'taskly-read-only-staging')
  const auth = getAuth(app)
  await setPersistence(auth, inMemoryPersistence)
  const db = initializeFirestore(app, {})
  return Object.freeze({
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    subscribe: next => onAuthStateChanged(auth, next),
    reader() {
      return createReadOnlyReader({ uid: auth.currentUser?.uid, currentUid: () => auth.currentUser?.uid,
        read: async path => { const snap = await getDocFromServer(doc(db, path)); return snap.exists() ? snap.data() : null },
        list: async path => {
          const snap = await getDocsFromServer(query(collection(db, path), limit(51)))
          if (snap.size > 50) throw new Error('Synthetic dataset exceeds staging limit.')
          return snap.docs.map(item => ({ id: item.id, data: item.data() }))
        },
      })
    },
  })
}
