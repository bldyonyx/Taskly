import { initializeApp, getApps } from 'firebase/app'
import { assertProductionConfig } from './environment.js'
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'firebase/auth'

// Only Auth is initialized. There are no Firestore imports or task-data hooks.
export function createFirebaseAuthClient(config, sdk = { initializeApp, getApps, getAuth,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail }) {
  assertProductionConfig(config)
  const existing = sdk.getApps().find((app) => app.name === '[DEFAULT]')
  if (existing && Object.keys(config).some((key) => existing.options[key] !== config[key])) {
    throw new Error('Existing default Firebase app does not match production Authentication configuration.')
  }
  const app = existing ?? sdk.initializeApp(config)
  const auth = sdk.getAuth(app)
  auth.useDeviceLanguage()
  return {
    subscribe: (onUser, onError) => sdk.onAuthStateChanged(auth, onUser, onError),
    signup: (email, password) => sdk.createUserWithEmailAndPassword(auth, email, password),
    login: (email, password) => sdk.signInWithEmailAndPassword(auth, email, password),
    logout: () => sdk.signOut(auth),
    reset: (email) => sdk.sendPasswordResetEmail(auth, email),
  }
}
