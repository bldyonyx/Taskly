import { randomUUID } from 'node:crypto'
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { assertStagingActivation } from '../../src/staging/config.js'
import { createMutationCore } from '../trusted/core.mjs'
import { createSignedIdentity } from './identity.mjs'
import { createHttpsAdapter } from './https.mjs'

export function assertRemoteEnvironment(env) {
  if (Object.keys(env).some(key => /EMULATOR|FIRESTORE_HOST|FIREBASE_AUTH_HOST/.test(key) && env[key] !== undefined)
    || env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_CONFIG
    || env.GCLOUD_PROJECT !== env.TASKLY_STAGING_PROJECT_ID
    || (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== env.TASKLY_STAGING_PROJECT_ID)) {
    throw new Error('Mixed, emulator or credential-file staging runtime rejected.')
  }
}

// No listener, exported cloud function or deployment manifest. Importing this
// module never initializes Admin; activation fails before ADC/network use.
export function createStagingRuntime(env = process.env) {
  const assertRuntime = () => {
    assertRemoteEnvironment(env)
    // Admin SDK routing also consults the actual process environment. A supplied
    // config object must never hide ambient emulator or mixed-project settings.
    assertRemoteEnvironment({ ...process.env, TASKLY_STAGING_PROJECT_ID: env.TASKLY_STAGING_PROJECT_ID })
    return assertStagingActivation(env)
  }
  const config = assertRuntime()
  const app = initializeApp({ projectId: config.projectId, credential: applicationDefault() }, `staging-${randomUUID()}`)
  const db = getFirestore(app)
  const executeVerified = createMutationCore({ db, assertRuntime, maxDocuments: config.maxDocuments })
  const verifyIdentity = createSignedIdentity({ auth: getAuth(app), projectId: config.projectId })
  return { handle: createHttpsAdapter({ config, verifyIdentity, executeVerified, assertRuntime }),
    close: async () => { await db.terminate(); await deleteApp(app) } }
}
