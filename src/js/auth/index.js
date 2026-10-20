import { readFirebaseConfig } from './config.js'
import { selectNormalAuthConfig } from './environment.js'
import { createAuthSession } from './session.js'

export const authSession = createAuthSession(async () => {
  const config = selectNormalAuthConfig(import.meta.env, readFirebaseConfig)
  if (!config) return null
  const { createFirebaseAuthClient } = await import('./firebase.js')
  return createFirebaseAuthClient(config)
})
