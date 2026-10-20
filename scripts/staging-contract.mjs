// Tooling-only contract. No SDK, entry point, project allowlist or activation yet.
export const APPROVED_STAGING_PROJECT = null
export const STAGING_WRITES_ENABLED = false

export function validateStagingConfig(env = {}) {
  const projectId = env.TASKLY_STAGING_PROJECT_ID
  if (env.TASKLY_STAGING_ENV !== 'staging') throw new Error('Explicit staging environment identity required.')
  if (!projectId || projectId === 'taskly-maya' || projectId.startsWith('demo-')
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Dedicated non-production staging project required.')
  if (env.TASKLY_STAGING_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`
    || !env.TASKLY_STAGING_API_KEY || env.TASKLY_STAGING_API_KEY === 'emulator-only-key'
    || !/^1:\d+:web:[a-zA-Z0-9]+$/.test(env.TASKLY_STAGING_APP_ID ?? '')) {
    throw new Error('Dedicated, consistent staging web app configuration required.')
  }
  if (APPROVED_STAGING_PROJECT !== projectId) throw new Error('Staging project has not been approved and pinned in reviewed source.')
  return Object.freeze({ projectId })
}

export function assertStagingActivation(env) {
  validateStagingConfig(env)
  throw new Error('Staging runtime and writes are not implemented or authorized.')
}
