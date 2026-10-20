import { installLoopbackGuard } from './network.mjs'

export const PROJECT = 'demo-taskly-trusted'
export const FIRESTORE_HOST = '127.0.0.1:8087'
export const AUTH_HOST = '127.0.0.1:9100'

// Exact numeric loopback addresses avoid DNS, endpoint and credential fallbacks.
// Rechecked before every operation, not just SDK construction.
export function assertEmulators(env = process.env) {
  let cliConfigSafe = !env.FIREBASE_CONFIG
  if (env.FIREBASE_CONFIG) {
    try {
      const config = JSON.parse(env.FIREBASE_CONFIG)
      cliConfigSafe = config.projectId === PROJECT
        && Object.keys(config).every((key) => ['projectId', 'storageBucket', 'databaseURL'].includes(key))
        && (!config.storageBucket || config.storageBucket === `${PROJECT}.appspot.com`)
        && (!config.databaseURL || config.databaseURL === `https://${PROJECT}.firebaseio.com`)
    } catch { cliConfigSafe = false }
  }
  if (env.GCLOUD_PROJECT !== PROJECT || env.FIRESTORE_EMULATOR_HOST !== FIRESTORE_HOST
    || env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_HOST
    || (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== PROJECT)
    || env.GOOGLE_APPLICATION_CREDENTIALS || !cliConfigSafe
    || env.FIRESTORE_EMULATOR_HOST_PATH || env.GOOGLE_API_USE_MTLS_ENDPOINT === 'always') {
    throw new Error('Trusted prototype requires the exact local demo Auth/Firestore emulators and no credentials.')
  }
}
export function prepareLocalRuntime() {
  assertEmulators()
  // google-auth otherwise probes the GCE metadata server even for insecure
  // emulator channels. Disable probing before constructing any SDK instance.
  process.env.METADATA_SERVER_DETECTION = 'none'
  installLoopbackGuard()
}
