import { initializeApp, getApps } from 'firebase/app'
import { getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { createAuthSession } from '../js/auth/session.js'
import { createFirestoreRepository } from '../js/firestore/repository.js'
import { createFirestoreTransport } from '../js/firestore/firebase.js'
import { createAccountData } from '../js/data/account.js'
import { assertIsolatedRuntime, ISOLATED_PROJECT, ISOLATED_AUTH_PORT, ISOLATED_FIRESTORE_PORT } from './config.js'

// No configuration or keys are read from .env, the default app, or production Auth.
export async function createIsolatedRuntime(guard) {
  assertIsolatedRuntime(guard)
  if (getApps().some((app) => app.name === 'taskly-isolated')) throw new Error('Isolated runtime already exists; reload the page.')
  const app = initializeApp({ projectId: ISOLATED_PROJECT, apiKey: 'emulator-only-key',
    authDomain: 'localhost', appId: 'taskly-isolated-emulator' }, 'taskly-isolated')
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://127.0.0.1:${ISOLATED_AUTH_PORT}`, { disableWarnings: false })
  const db = initializeFirestore(app, {})
  connectFirestoreEmulator(db, '127.0.0.1', ISOLATED_FIRESTORE_PORT)
  // Persistence is scoped to this named demo app; refresh can restore test Auth.
  await setPersistence(auth, browserLocalPersistence)
  const session = createAuthSession(async () => ({
    subscribe: (next, error) => onAuthStateChanged(auth, next, error),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth), reset: (email) => sendPasswordResetEmail(auth, email),
  }))
  return { session, async account(uid) {
    if (session.getState().user?.uid !== uid || auth.currentUser?.uid !== uid) throw new Error('Test account session changed.')
    const check = () => {
      if (auth.currentUser?.uid !== uid) throw new Error('Test account session changed.')
    }
    return createAccountData(createFirestoreRepository({ uid, session,
      transport: createFirestoreTransport({ database: () => { check(); return db }, check }) }))
  } }
}
