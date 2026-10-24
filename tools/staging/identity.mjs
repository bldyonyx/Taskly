import { validId } from '../../src/js/firestore/schema.js'
import { requireThat } from '../trusted/commands.mjs'

// auth is the project-bound Admin Auth instance in runtime.mjs. Injection is for
// local tests, not a browser-selectable verifier. Never decode a JWT as proof.
export function createSignedIdentity({ auth, projectId, now = Date.now }) {
  return async token => {
    try {
      requireThat(typeof token === 'string' && token.length <= 16384 && token.length > 0, 'unauthenticated')
      const identity = await auth.verifyIdToken(token, true)
      const seconds = Math.floor(now() / 1000)
      requireThat(identity.aud === projectId && identity.iss === `https://securetoken.google.com/${projectId}`
        && validId(identity.uid) && identity.sub === identity.uid
        && Number.isSafeInteger(identity.exp) && identity.exp > seconds
        && Number.isSafeInteger(identity.iat) && identity.iat <= seconds && identity.iat >= 0
        && Number.isSafeInteger(identity.auth_time) && identity.auth_time <= seconds && identity.auth_time >= 0,
      'unauthenticated')
      const user = await auth.getUser(identity.uid)
      requireThat(user.uid === identity.uid && !user.disabled, 'unauthenticated')
      return identity.uid
    } catch { requireThat(false, 'unauthenticated', 'Authentication required.') }
  }
}
