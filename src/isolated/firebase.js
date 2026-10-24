import { initializeApp, getApps } from 'firebase/app'
import { getAuth, connectAuthEmulator, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { createAuthSession } from '../js/auth/session.js'
import { createFirestoreRepository } from '../js/firestore/repository.js'
import { createFirestoreTransport } from '../js/firestore/firebase.js'
import { createAccountData } from '../js/data/account.js'
import { createTrustedAccount } from './trusted.js'
import { assertIsolatedRuntime, assertEmulatorConfig, assertSyntheticEmail, ISOLATED_CONFIG } from './config.js'

// No configuration or keys are read from .env, the default app, or production Auth.
export async function createIsolatedRuntime(guard, configuration = ISOLATED_CONFIG) {
  assertIsolatedRuntime(guard)
  const config = assertEmulatorConfig(configuration)
  if (getApps().some((app) => app.name === 'taskly-isolated')) throw new Error('Isolated runtime already exists; reload the page.')
  const app = initializeApp({ projectId: config.projectId, apiKey: 'emulator-only-key',
    authDomain: 'localhost', appId: 'taskly-isolated-emulator' }, 'taskly-isolated')
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${config.authHost}:${config.authPort}`, { disableWarnings: false })
  const db = initializeFirestore(app, {})
  connectFirestoreEmulator(db, config.firestoreHost, config.firestorePort)
  // Persistence is scoped to this named demo app; refresh can restore test Auth.
  await setPersistence(auth, browserLocalPersistence)
  const session = createAuthSession(async () => ({
    subscribe: (next, error) => onAuthStateChanged(auth, next, error),
    signup: (email, password) => createUserWithEmailAndPassword(auth, assertSyntheticEmail(email), password),
    login: (email, password) => signInWithEmailAndPassword(auth, assertSyntheticEmail(email), password),
    logout: () => signOut(auth), reset: (email) => sendPasswordResetEmail(auth, assertSyntheticEmail(email)),
  }))
  return { session, async account(uid) {
    if (session.getState().user?.uid !== uid || auth.currentUser?.uid !== uid) throw new Error('Test account session changed.')
    const check = () => {
      if (auth.currentUser?.uid !== uid) throw new Error('Test account session changed.')
    }
    const transport = createFirestoreTransport({ database: () => { check(); return db }, check })
    const readOnly = { ...transport, transact: (paths, plan) => transport.transact(paths, (values) => {
      const changes = plan(values)
      if (changes.length) throw new Error('Direct writes are disabled in trusted mode.')
      return []
    }) }
    const reader = createAccountData(createFirestoreRepository({ uid, session, transport: readOnly }))
    return createTrustedAccount({ reader, user: auth.currentUser, check })
  } }
}
