import { readFirebaseConfig } from './config.js'
import { createAuthSession } from './session.js'

export const authSession = createAuthSession(async () => {
  const config = readFirebaseConfig(import.meta.env)
  if (!config) return null
  const { createFirebaseAuthClient } = await import('./firebase.js')
  return createFirebaseAuthClient(config)
})
