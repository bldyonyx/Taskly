// Public configuration only. No project has been approved; flags cannot unlock it.
export const APPROVED_STAGING = null
export const STAGING_WRITES_ENABLED = false

export function stagingShape(env) {
  const projectId = env.TASKLY_STAGING_PROJECT_ID
  if (env.TASKLY_STAGING_ENV !== 'staging' || typeof projectId !== 'string'
    || projectId === 'taskly-maya' || projectId.startsWith('demo-')
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) throw new Error('Dedicated staging identity required.')
  if (env.TASKLY_STAGING_AUTH_DOMAIN !== `${projectId}.firebaseapp.com`
    || !env.TASKLY_STAGING_API_KEY || env.TASKLY_STAGING_API_KEY === 'emulator-only-key'
    || !/^1:\d+:web:[a-zA-Z0-9]+$/.test(env.TASKLY_STAGING_APP_ID ?? '')) throw new Error('Dedicated staging web tuple required.')
  const origin = new URL(env.TASKLY_STAGING_ORIGIN)
  const endpoint = new URL(env.TASKLY_STAGING_ENDPOINT)
  if ([origin, endpoint].some(u => u.protocol !== 'https:' || u.username || u.password || u.port
    || u.hostname === 'localhost' || /^[\d.:]+$/.test(u.hostname) || u.hostname.includes('taskly-maya'))
    || origin.href !== `${origin.origin}/` || endpoint.pathname !== '/mutate' || endpoint.search || endpoint.hash) {
    throw new Error('Exact staging HTTPS origin and /mutate endpoint required.')
  }
  const maxDocuments = Number(env.TASKLY_STAGING_MAX_DOCUMENTS ?? 50)
  if (!Number.isInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 50) throw new Error('Pilot document cap must be 1–50.')
  return Object.freeze({ environment: 'staging', projectId, authDomain: env.TASKLY_STAGING_AUTH_DOMAIN,
    apiKey: env.TASKLY_STAGING_API_KEY, appId: env.TASKLY_STAGING_APP_ID,
    origin: origin.origin, endpoint: endpoint.href, maxDocuments })
}

export function validateStagingConfig(env) {
  const config = stagingShape(env)
  if (!APPROVED_STAGING || Object.keys(config).some(key => config[key] !== APPROVED_STAGING[key])) {
    throw new Error('Staging tuple has not been approved and pinned in reviewed source.')
  }
  return config
}

export function assertStagingActivation(env) {
  const config = validateStagingConfig(env)
  if (!STAGING_WRITES_ENABLED || env.TASKLY_STAGING_ACTIVATE !== 'approved-synthetic-pilot') throw new Error('Staging runtime and writes remain disabled.')
  return config
}
