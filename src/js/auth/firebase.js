import { initializeApp, getApp, getApps } from 'firebase/app'
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth'

// Only Auth is initialized. There are no Firestore imports or task-data hooks.
export function createFirebaseAuthClient(config) {
  const app = getApps().length ? getApp() : initializeApp(config)
  const auth = getAuth(app)
  auth.useDeviceLanguage()
  return {
    subscribe: (onUser, onError) => onAuthStateChanged(auth, onUser, onError),
    signup: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    login: (email, password) => signInWithEmailAndPassword(auth, email, password),
    logout: () => signOut(auth),
    reset: (email) => sendPasswordResetEmail(auth, email),
  }
}
