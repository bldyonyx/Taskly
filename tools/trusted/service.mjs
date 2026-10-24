import { randomUUID } from 'node:crypto'
import { initializeApp, deleteApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Firestore } from 'firebase-admin/firestore'
import { validId } from '../../src/js/firestore/schema.js'
import { assertEmulators, prepareLocalRuntime, PROJECT, FIRESTORE_HOST } from './config.mjs'
import { requireThat } from './commands.mjs'
import { createMutationCore } from './core.mjs'

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
  const executeVerified = createMutationCore({ db, assertRuntime: assertEmulators })
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
        return await executeVerified(identity.uid, input)
      } catch (error) {
        return { ok: false, code: error.trustedCode ?? 'unavailable', confirmed: false,
          message: error.trustedCode ? error.message : 'Mutation could not be confirmed; retry the same request ID.' }
      }
    },
    close: async () => { await db.terminate(); await deleteApp(app) },
  }
}
